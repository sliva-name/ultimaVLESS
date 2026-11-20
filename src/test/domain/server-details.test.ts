import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseDirectLinksFromText } from '@/main/services/subscription/linkParsing';
import { buildServerDetails } from '@/main/services/serverDetails';
import { getAppStore } from '@/main/infrastructure/persistence/appStore';
import { createServerRepository } from '@/main/infrastructure/persistence/ElectronServerRepository';
import {
  getServerConfigFingerprint,
  isSameServerIdentity,
  uniqueCatalogServers,
} from '@/shared/serverIdentity';
import { toSafeServer } from '@/shared/serverView';
import {
  REDACTED,
  sanitizeDiagnosticPayload,
  sanitizeSensitiveText,
} from '@/shared/sanitizeDiagnostics';
import type { VlessConfig } from '@/shared/types';
import { makeServer } from '@/test/factories';

const UUID = '3c1a510c-3862-4e0f-b007-786b0146fc14';
const PBK = 'BrqPWRafR8cHvpnRB0ElYA_Zn7A-F8Ugj_x6f24MWD8';
const REALITY_LINK = `vless://${UUID}@nl.example.net:443?type=tcp&security=reality&sni=www.example.com&fp=chrome&pbk=${PBK}&sid=ab12&flow=xtls-rprx-vision&encryption=none#Netherlands`;

function parseOne(text: string): VlessConfig {
  const configs = parseDirectLinksFromText(text);
  expect(configs).toHaveLength(1);
  return configs[0]!;
}

describe('share link kept with the parsed server', () => {
  it('stores the link a server was parsed from, entities decoded', () => {
    expect(parseOne(REALITY_LINK).shareLink).toBe(REALITY_LINK);
    expect(
      parseOne(`<a href="${REALITY_LINK.replace(/&/g, '&amp;')}">`).shareLink,
    ).toBe(REALITY_LINK);
  });

  it('is no identity: the same server written differently stays one server', () => {
    const server = parseOne(REALITY_LINK);
    const reordered = parseOne(
      `vless://${UUID}@nl.example.net:443?security=reality&type=tcp&fp=chrome&sni=www.example.com&sid=ab12&pbk=${PBK}&encryption=none&flow=xtls-rprx-vision#Netherlands`,
    );
    const stored = { ...server };
    delete stored.shareLink;

    expect(reordered.shareLink).not.toBe(server.shareLink);
    expect(isSameServerIdentity(server, reordered)).toBe(true);
    expect(getServerConfigFingerprint(server)).toBe(
      getServerConfigFingerprint(stored),
    );
    expect(uniqueCatalogServers([server, reordered])).toHaveLength(1);
  });

  it('never reaches the renderer snapshot', () => {
    expect(toSafeServer(parseOne(REALITY_LINK))).not.toHaveProperty(
      'shareLink',
    );
  });
});

describe('server details', () => {
  it('lists a REALITY server in reading order with the credential marked', () => {
    const details = buildServerDetails(parseOne(REALITY_LINK));

    expect(details.fields).toEqual([
      { key: 'protocol', value: 'VLESS' },
      { key: 'address', value: 'nl.example.net' },
      { key: 'port', value: '443' },
      { key: 'userId', value: UUID, secret: true },
      { key: 'encryption', value: 'none' },
      { key: 'flow', value: 'xtls-rprx-vision' },
      { key: 'transport', value: 'tcp' },
      { key: 'security', value: 'reality' },
      { key: 'sni', value: 'www.example.com' },
      { key: 'fingerprint', value: 'chrome' },
      { key: 'publicKey', value: PBK },
      { key: 'shortId', value: 'ab12' },
    ]);
    expect(details.shareLink).toBe(REALITY_LINK);
    expect(details.rawConfig).toBeUndefined();
  });

  it('marks Trojan, Shadowsocks and Hysteria passwords as secret', () => {
    const trojan = buildServerDetails(
      parseOne('trojan://s3cret@tj.example.net:443?sni=tj.example.net#TJ'),
    );
    expect(trojan.fields).toContainEqual({
      key: 'password',
      value: 's3cret',
      secret: true,
    });

    const hysteria = buildServerDetails(
      parseOne(
        'hy2://auth-key@hy.example.net:8443?sni=hy.example.net&obfs=salamander&obfs-password=obfs-key#HY',
      ),
    );
    expect(hysteria.fields.filter((field) => field.secret)).toEqual([
      { key: 'password', value: 'auth-key', secret: true },
      { key: 'obfsPassword', value: 'obfs-key', secret: true },
    ]);
    expect(hysteria.fields.map((field) => field.key)).not.toContain(
      'transport',
    );
  });

  it('shows a WireGuard server by its keys and peers', () => {
    const details = buildServerDetails(
      makeServer({
        protocol: 'wireguard',
        address: '198.51.100.7',
        port: 51820,
        wgSecretKey: 'private-key',
        wgAddress: ['10.0.0.2/32', 'fd00::2/128'],
        wgPeers: [
          {
            endpoint: '198.51.100.7:51820',
            publicKey: 'peer-key',
            preSharedKey: 'psk',
          },
        ],
        wgMtu: 1280,
      }),
    );

    expect(details.fields).toEqual([
      { key: 'protocol', value: 'WireGuard' },
      { key: 'address', value: '198.51.100.7' },
      { key: 'port', value: '51820' },
      { key: 'wgPrivateKey', value: 'private-key', secret: true },
      { key: 'wgAddress', value: '10.0.0.2/32, fd00::2/128' },
      { key: 'wgEndpoint', value: '198.51.100.7:51820' },
      { key: 'wgPublicKey', value: 'peer-key' },
      { key: 'wgPreSharedKey', value: 'psk', secret: true },
      { key: 'mtu', value: '1280' },
    ]);
  });

  it('offers the provider config for a JSON server, which has no link', () => {
    const rawConfig = { outbounds: [{ protocol: 'vless', tag: 'proxy' }] };
    const details = buildServerDetails(
      makeServer({ rawConfig } as Partial<VlessConfig>),
    );

    expect(details.shareLink).toBeUndefined();
    expect(JSON.parse(details.rawConfig!)).toEqual(rawConfig);
  });
});

describe('server repository and share links', () => {
  const store = getAppStore();
  const getMock = store.get as unknown as ReturnType<typeof vi.fn>;
  const setMock = store.set as unknown as ReturnType<typeof vi.fn>;
  let data: Record<string, unknown>;

  beforeEach(() => {
    data = { servers: [makeServer({ uuid: 'a' })], serverPings: {} };
    getMock.mockReset();
    getMock.mockImplementation((key: string) => data[key]);
    setMock.mockReset();
    setMock.mockImplementation((key: string, value: unknown) => {
      data[key] = value;
    });
  });

  it('writes the first refresh that brings links, though identity is unchanged', () => {
    const repository = createServerRepository();
    repository.savePings!({});
    setMock.mockClear();

    repository.saveAll([
      makeServer({ uuid: 'a', shareLink: 'vless://a@example.com:443' }),
    ]);

    expect(setMock).toHaveBeenCalledWith('servers', [
      expect.objectContaining({ shareLink: 'vless://a@example.com:443' }),
    ]);
    expect(repository.get('a')?.shareLink).toBe('vless://a@example.com:443');
  });
});

describe('share links in diagnostics', () => {
  it('redacts a whole share link in text: a Trojan password looks like nothing', () => {
    expect(
      sanitizeSensitiveText(
        'failed trojan://hunter2@tj.example.net:443?sni=x#TJ then ss://YWVzOnB3@1.2.3.4:8388',
      ),
    ).toBe('failed trojan://*** then ss://***');
  });

  it('redacts the shareLink field of a logged server', () => {
    expect(
      sanitizeDiagnosticPayload({ name: 'NL', shareLink: REALITY_LINK }),
    ).toEqual({ name: 'NL', shareLink: REDACTED });
  });
});
