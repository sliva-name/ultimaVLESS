import { describe, expect, it } from 'vitest';
import {
  assertAllowInsecureNotUsed,
  assertEncryptedPublicOutbound,
  assertSupportedShadowsocksMethod,
  isDialingUdpMask,
  isPrivateOrLocalEndpoint,
  isServerPublicOutboundCompatible,
  migrateLegacyUdpHop,
  normalizeVmessSecurity,
  requiresPublicTrojanMux,
  wireGuardTargetStrategy,
} from '@/main/services/configGenerator/outboundCompat';
import { makeServer } from '@/test/factories';
import type { XrayConfig } from '@/shared/xray-types';

describe('outboundCompat', () => {
  it('detects private and local endpoints', () => {
    expect(isPrivateOrLocalEndpoint('127.0.0.1')).toBe(true);
    expect(isPrivateOrLocalEndpoint('192.168.1.1')).toBe(true);
    expect(isPrivateOrLocalEndpoint('10.0.0.5')).toBe(true);
    expect(isPrivateOrLocalEndpoint('localhost')).toBe(true);
    expect(isPrivateOrLocalEndpoint('router.local')).toBe(true);
    expect(isPrivateOrLocalEndpoint('intranet')).toBe(true);
    expect(isPrivateOrLocalEndpoint('example.com')).toBe(false);
    expect(isPrivateOrLocalEndpoint('1.1.1.1')).toBe(false);
    expect(isPrivateOrLocalEndpoint('2001:db8::1')).toBe(false);
    expect(isPrivateOrLocalEndpoint('[2001:db8::1]')).toBe(false);
    expect(isPrivateOrLocalEndpoint('::1')).toBe(true);
    expect(isPrivateOrLocalEndpoint('[::1]')).toBe(true);
    expect(isPrivateOrLocalEndpoint('::ffff:192.168.0.1')).toBe(true);
    expect(isPrivateOrLocalEndpoint('::ffff:1.1.1.1')).toBe(false);
  });

  it('coerces removed VMess security values to auto', () => {
    expect(normalizeVmessSecurity('none')).toBe('auto');
    expect(normalizeVmessSecurity('zero')).toBe('auto');
    expect(normalizeVmessSecurity('aes-128-gcm')).toBe('aes-128-gcm');
  });

  it('rejects removed Shadowsocks methods', () => {
    expect(() => assertSupportedShadowsocksMethod('none')).toThrow(
      /removed in Xray/,
    );
    expect(() => assertSupportedShadowsocksMethod('plain')).toThrow(
      /removed in Xray/,
    );
    expect(() => assertSupportedShadowsocksMethod('aes-128-gcm')).not.toThrow();
  });

  it('rejects unencrypted public VLESS/Trojan outbounds', () => {
    expect(() =>
      assertEncryptedPublicOutbound({
        protocol: 'vless',
        address: 'example.com',
        streamSecurity: 'none',
        vlessEncryption: 'none',
      }),
    ).toThrow(/TLS\/REALITY/);

    expect(() =>
      assertEncryptedPublicOutbound({
        protocol: 'trojan',
        address: '1.1.1.1',
        streamSecurity: 'none',
      }),
    ).toThrow(/Trojan requires TLS/);

    expect(() =>
      assertEncryptedPublicOutbound({
        protocol: 'vless',
        address: 'example.com',
        streamSecurity: 'reality',
      }),
    ).not.toThrow();

    expect(() =>
      assertEncryptedPublicOutbound({
        protocol: 'vless',
        address: '192.168.0.10',
        streamSecurity: 'none',
      }),
    ).not.toThrow();

    expect(() =>
      assertEncryptedPublicOutbound({
        protocol: 'vless',
        address: '2001:db8::1',
        streamSecurity: 'none',
      }),
    ).toThrow(/TLS\/REALITY/);

    expect(() =>
      assertEncryptedPublicOutbound({
        protocol: 'vless',
        address: '[2001:db8::1]',
        streamSecurity: 'reality',
      }),
    ).not.toThrow();
  });

  it('requires TLS for public Hysteria outbounds', () => {
    expect(() =>
      assertEncryptedPublicOutbound({
        protocol: 'hysteria',
        address: 'example.com',
        streamSecurity: 'none',
      }),
    ).toThrow(/Hysteria requires/);

    expect(() =>
      assertEncryptedPublicOutbound({
        protocol: 'hysteria',
        address: 'example.com',
        streamSecurity: 'tls',
      }),
    ).not.toThrow();
  });

  it('rejects allowInsecure', () => {
    expect(() => assertAllowInsecureNotUsed(true)).toThrow(/allowInsecure/);
    expect(() => assertAllowInsecureNotUsed(false)).not.toThrow();
  });

  it('requires Mux for public Trojan addresses only', () => {
    expect(requiresPublicTrojanMux('example.com')).toBe(true);
    expect(requiresPublicTrojanMux('192.168.0.10')).toBe(false);
  });

  it('classifies catalog servers with the same public-outbound rules as generation', () => {
    expect(
      isServerPublicOutboundCompatible(
        makeServer({
          protocol: 'vless',
          address: '1.2.3.4',
          security: 'none',
        }),
      ),
    ).toBe(false);
    expect(
      isServerPublicOutboundCompatible(
        makeServer({
          protocol: 'vless',
          address: 'example.com',
          security: 'reality',
        }),
      ),
    ).toBe(true);
    expect(
      isServerPublicOutboundCompatible(
        makeServer({
          protocol: 'vless',
          address: '2001:db8::1',
          security: 'none',
        }),
      ),
    ).toBe(false);
    expect(
      isServerPublicOutboundCompatible(
        makeServer({
          protocol: 'vless',
          address: '192.168.0.10',
          security: 'none',
        }),
      ),
    ).toBe(true);
    expect(
      isServerPublicOutboundCompatible(
        makeServer({
          protocol: 'vless',
          address: 'example.com',
          security: 'none',
          encryption: 'mlkem768x25519plus',
        }),
      ),
    ).toBe(true);
  });

  it('prefers raw outbound stream security over structured fields', () => {
    expect(
      isServerPublicOutboundCompatible(
        makeServer({
          address: 'example.com',
          security: 'tls',
          rawConfig: {
            outbounds: [
              {
                tag: 'proxy',
                protocol: 'vless',
                settings: { address: '1.2.3.4', encryption: 'none' },
                streamSettings: { network: 'tcp', security: 'none' },
              },
            ],
          } as XrayConfig,
        }),
      ),
    ).toBe(false);
    expect(
      isServerPublicOutboundCompatible(
        makeServer({
          address: '1.2.3.4',
          security: 'none',
          rawConfig: {
            outbounds: [
              {
                tag: 'proxy',
                protocol: 'vless',
                settings: { address: 'example.com', encryption: 'none' },
                streamSettings: { network: 'tcp', security: 'reality' },
              },
            ],
          } as XrayConfig,
        }),
      ),
    ).toBe(true);
  });

  it('maps the removed WireGuard domainStrategy to targetStrategy', () => {
    expect(wireGuardTargetStrategy('ForceIPv4')).toBe('ForceIPv4');
    expect(wireGuardTargetStrategy(' forceipv6v4 ')).toBe('ForceIPv6v4');
    expect(wireGuardTargetStrategy('ForceIP')).toBe('ForceIP');
    expect(wireGuardTargetStrategy('UseIP')).toBeUndefined();
    expect(wireGuardTargetStrategy(undefined)).toBeUndefined();
  });

  it('moves quicParams.udpHop into a leading udphop mask', () => {
    const finalmask: Record<string, unknown> = {
      udp: [{ type: 'salamander', settings: { password: 'p' } }],
      quicParams: {
        congestion: 'bbr',
        udpHop: { ports: '20000-30000', interval: '5-30' },
      },
    };

    migrateLegacyUdpHop(finalmask);

    expect(finalmask).toEqual({
      udp: [
        {
          type: 'udphop',
          settings: {
            mode: 'intervalLocal,intervalRemote',
            remotePorts: '20000-30000',
            interval: '5-30',
          },
        },
        { type: 'salamander', settings: { password: 'p' } },
      ],
      quicParams: { congestion: 'bbr' },
    });
  });

  it('drops a legacy udpHop without ports or next to a dialing mask', () => {
    const withoutPorts: Record<string, unknown> = {
      quicParams: { udpHop: { interval: 30 } },
    };
    migrateLegacyUdpHop(withoutPorts);
    expect(withoutPorts).toEqual({});

    const alreadyMigrated: Record<string, unknown> = {
      udp: [{ type: 'udpHop', settings: { mode: 'intervalRemote' } }],
      quicParams: { udpHop: { ports: 443 } },
    };
    migrateLegacyUdpHop(alreadyMigrated);
    expect(alreadyMigrated).toEqual({
      udp: [{ type: 'udpHop', settings: { mode: 'intervalRemote' } }],
    });
    expect(isDialingUdpMask({ type: 'xicmp' })).toBe(true);
    expect(isDialingUdpMask({ type: 'salamander' })).toBe(false);
  });
});
