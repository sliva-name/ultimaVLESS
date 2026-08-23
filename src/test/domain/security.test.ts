import { describe, expect, it } from 'vitest';
import {
  createStableServerId,
  findMatchingServer,
  getServerEndpointKey,
  isSameServerIdentity,
  uniqueCatalogServers,
} from '@/shared/serverIdentity';
import { isSameServerRow } from '@/shared/serverRow';
import { toSafeServer } from '@/shared/serverView';
import {
  isPrivateOrReservedHost,
  isValidIpOrCidr,
  isValidIpv4Address,
  isValidIpv6Address,
} from '@/shared/networkAddresses';
import {
  REDACTED,
  sanitizeDiagnosticPayload,
  sanitizeSensitiveText,
} from '@/shared/sanitizeDiagnostics';
import { makeServer } from '@/test/factories';

describe('safe public server DTO', () => {
  it('creates deterministic identities and matches by fingerprint after uuid rotation', () => {
    const first = createStableServerId('user-id', 'example.com', 443, [
      'tcp',
      'reality',
    ]);
    const second = createStableServerId('user-id', 'example.com', 443, [
      'tcp',
      'reality',
    ]);
    const current = makeServer({
      uuid: 'old-id',
      name: 'Frankfurt',
      address: '1.2.3.4',
      sni: 'a.example',
    });
    const rotated = makeServer({
      uuid: 'new-id',
      name: 'Frankfurt',
      address: '1.2.3.4',
      sni: 'a.example',
    });
    const otherHost = makeServer({
      uuid: 'other-host',
      name: 'Frankfurt',
      address: '9.9.9.9',
      sni: 'a.example',
    });
    const otherSni = makeServer({
      uuid: 'other-sni',
      name: 'Frankfurt',
      address: '1.2.3.4',
      sni: 'b.example',
    });

    expect(first).toBe(second);
    expect(getServerEndpointKey(current)).toBe('vless|1.2.3.4:443');
    expect(isSameServerIdentity(current, rotated)).toBe(true);
    expect(isSameServerIdentity(current, otherHost)).toBe(false);
    expect(isSameServerIdentity(current, otherSni)).toBe(false);
    expect(
      isSameServerIdentity(
        makeServer({ uuid: 'dup', name: 'Germany', sni: 'de.example' }),
        makeServer({ uuid: 'dup', name: 'Netherlands', sni: 'nl.example' }),
      ),
    ).toBe(false);
    expect(
      isSameServerIdentity(
        makeServer({ uuid: 'a', name: 'Germany', sid: 'aa' }),
        makeServer({ uuid: 'b', name: 'Germany', sid: 'bb' }),
      ),
    ).toBe(false);
    expect(
      isSameServerIdentity(
        makeServer({ uuid: 'a', name: 'Germany 1', address: '1.2.3.4' }),
        makeServer({ uuid: 'b', name: 'Germany 2', address: '1.2.3.4' }),
      ),
    ).toBe(false);
    expect(findMatchingServer([rotated, otherSni], current)?.uuid).toBe(
      'new-id',
    );
  });

  it('keeps every server that differs by any field and drops only exact copies', () => {
    const first = makeServer({
      uuid: 'dup',
      name: 'Germany',
      sni: 'de.example',
    });
    const collided = makeServer({
      uuid: 'dup',
      name: 'Netherlands',
      sni: 'nl.example',
    });
    const sameHostDifferentName = makeServer({
      uuid: 'dup',
      name: 'Germany 2',
      sni: 'de.example',
    });
    const exactCopy = makeServer({
      uuid: 'dup',
      name: 'Germany',
      sni: 'de.example',
    });

    const unique = uniqueCatalogServers([
      first,
      collided,
      sameHostDifferentName,
      exactCopy,
    ]);
    expect(unique).toHaveLength(3);
    expect(unique.map((server) => server.name)).toEqual([
      'Germany',
      'Netherlands',
      'Germany 2',
    ]);
    expect(unique[0]?.uuid).toBe('dup');
    expect(unique[1]?.uuid).not.toBe('dup');
    expect(unique[2]?.uuid).not.toBe(unique[1]?.uuid);
  });

  it('does not treat two sidebar rows as selected just because uuids match', () => {
    const selected = makeServer({
      uuid: 'dup',
      name: 'Germany',
      sni: 'de.example',
    });
    const other = makeServer({
      uuid: 'dup',
      name: 'Netherlands',
      sni: 'nl.example',
    });

    expect(isSameServerRow(selected, selected)).toBe(true);
    expect(isSameServerRow(selected, other)).toBe(false);
  });

  it('strips credentials and raw Xray config from renderer-facing servers', () => {
    const safe = toSafeServer(
      makeServer({
        password: 'trojan-pass',
        userId: 'vless-user',
        pbk: 'reality-public',
        sid: 'ab',
        wgSecretKey: 'wg-secret',
        rawConfig: {
          inbounds: [],
          outbounds: [{ tag: 'proxy', protocol: 'vless', settings: {} }],
        },
      }),
    );

    expect(safe).not.toHaveProperty('password');
    expect(safe).not.toHaveProperty('userId');
    expect(safe).not.toHaveProperty('pbk');
    expect(safe).not.toHaveProperty('sid');
    expect(safe).not.toHaveProperty('wgSecretKey');
    expect(safe).not.toHaveProperty('rawConfig');
    expect(safe.uuid).toBe('server-1');
    expect(safe.address).toBe('example.com');
  });
});

describe('subscription fetch SSRF guard', () => {
  it('accepts public addresses and rejects junk', () => {
    expect(isValidIpv4Address('1.1.1.1')).toBe(true);
    expect(isValidIpv4Address('1.1.1.256')).toBe(false);
    expect(isValidIpv4Address('01.1.1.1')).toBe(false);
    expect(isValidIpv6Address('2001:db8::1')).toBe(true);
    expect(isValidIpv6Address('::ffff:192.168.0.1')).toBe(true);
    expect(isValidIpv6Address('2001::db8::1')).toBe(false);
    expect(isValidIpOrCidr('10.0.0.0/8')).toBe(true);
    expect(isValidIpOrCidr('2001:db8::/32')).toBe(true);
    expect(isValidIpOrCidr('10.0.0.0/33')).toBe(false);
    expect(isValidIpOrCidr('example.com/24')).toBe(false);
  });

  it('blocks loopback, RFC1918, CGNAT and IPv4-mapped private hosts', () => {
    expect(isPrivateOrReservedHost('localhost')).toBe(true);
    expect(isPrivateOrReservedHost('10.0.0.5')).toBe(true);
    expect(isPrivateOrReservedHost('192.168.1.1')).toBe(true);
    expect(isPrivateOrReservedHost('127.0.0.1')).toBe(true);
    expect(isPrivateOrReservedHost('169.254.1.1')).toBe(true);
    expect(isPrivateOrReservedHost('100.64.0.1')).toBe(true);
    expect(isPrivateOrReservedHost('172.16.0.1')).toBe(true);
    expect(isPrivateOrReservedHost('::1')).toBe(true);
    expect(isPrivateOrReservedHost('fe80::1')).toBe(true);
    expect(isPrivateOrReservedHost('fd12:3456::1')).toBe(true);
    expect(isPrivateOrReservedHost('::ffff:192.168.0.1')).toBe(true);
    expect(isPrivateOrReservedHost('1.1.1.1')).toBe(false);
    expect(isPrivateOrReservedHost('2001:db8::1')).toBe(false);
    expect(isPrivateOrReservedHost('example.com')).toBe(false);
  });
});

describe('diagnostic redaction', () => {
  it('redacts public addresses, UUIDs and URL credentials, keeps LAN/TUN facts', () => {
    expect(
      sanitizeSensitiveText(
        'connecting 11111111-2222-3333-4444-555555555555 via 203.0.113.7',
      ),
    ).not.toContain('11111111-2222');
    expect(sanitizeSensitiveText('peer 2001:db8::dead:beef ok')).not.toContain(
      '2001:db8',
    );
    expect(sanitizeSensitiveText('https://bob:s3cret@example.com/sub')).toBe(
      'https://***:***@example.com/sub',
    );
    expect(
      sanitizeSensitiveText('proxy 127.0.0.1:10808 gateway 192.168.1.1'),
    ).toBe('proxy 127.0.0.1:10808 gateway 192.168.1.1');
    expect(sanitizeSensitiveText('tun fe80::1 dns ::1 ula fd00::5')).toBe(
      'tun fe80::1 dns ::1 ula fd00::5',
    );
    expect(
      sanitizeSensitiveText('2026-08-11T19:56:36.123Z started at 19:56:36'),
    ).toContain('19:56:36');
  });

  it('redacts credential fields that no pattern could recognize', () => {
    const sanitized = sanitizeDiagnosticPayload({
      name: 'Server 1',
      port: 443,
      password: 'trojan-pass',
      pbk: 'reality-public-key',
      wgSecretKey: 'wg-private',
      shortId: 'ab12',
      nested: { apiToken: 'abc', keep: 'visible' },
      peers: [{ endpoint: 'example.com:51820', preSharedKey: 'psk-value' }],
    });

    expect(sanitized).toMatchObject({
      name: 'Server 1',
      port: 443,
      password: REDACTED,
      pbk: REDACTED,
      wgSecretKey: REDACTED,
      shortId: REDACTED,
      nested: { apiToken: REDACTED, keep: 'visible' },
    });
    expect(sanitized.peers[0].preSharedKey).toBe(REDACTED);
    expect(sanitized.peers[0].endpoint).toBe('example.com:51820');
  });
});
