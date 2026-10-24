import { describe, expect, it } from 'vitest';
import { parseDirectLinksFromText } from '@/main/services/subscription/linkParsing';
import { XrayConfigCompiler } from '@/main/services/XrayConfigCompiler';
import {
  createHashedIdentityToken,
  createStableServerId,
} from '@/shared/serverIdentity';
import { DEFAULT_PERFORMANCE_SETTINGS, type VlessConfig } from '@/shared/types';
import type { XrayOutbound, XrayStreamSettings } from '@/shared/xray-types';

const UUID = '3c1a510c-3862-4e0f-b007-786b0146fc14';
const PBK = 'BrqPWRafR8cHvpnRB0ElYA_Zn7A-F8Ugj_x6f24MWD8';

function parseOne(link: string): VlessConfig {
  const configs = parseDirectLinksFromText(link);
  expect(configs).toHaveLength(1);
  return configs[0]!;
}

function proxyOutbound(server: VlessConfig): XrayOutbound {
  return XrayConfigCompiler.compile(server, {
    logPath: '/tmp/xray.log',
    connectionMode: 'proxy',
  }).outbounds.find((outbound) => outbound.tag === 'proxy')!;
}

function stream(server: VlessConfig): XrayStreamSettings {
  return proxyOutbound(server).streamSettings as XrayStreamSettings;
}

describe('trojan share links', () => {
  it('keeps REALITY instead of downgrading it to TLS', () => {
    const server = parseOne(
      `trojan://pass@example.org:443?security=reality&sni=www.example.com&pbk=${PBK}&sid=ab&spx=%2F&fp=chrome&type=tcp#T`,
    );
    expect(server.security).toBe('reality');
    expect(stream(server)).toMatchObject({
      security: 'reality',
      realitySettings: {
        serverName: 'www.example.com',
        password: PBK,
        shortId: 'ab',
        spiderX: '/',
        fingerprint: 'chrome',
      },
    });
    expect(stream(server).tlsSettings).toBeUndefined();
  });

  it.each([
    ['xhttp', 'xhttpSettings', { path: '/tx', mode: 'auto' }],
    ['httpupgrade', 'httpupgradeSettings', { path: '/hu' }],
  ] as const)('keeps the %s transport', (type, key, expected) => {
    const server = parseOne(
      `trojan://pass@cdn.example.org:443?security=tls&sni=cdn.example.org&type=${type}&path=${encodeURIComponent(expected.path)}&mode=auto#T`,
    );
    const settings = stream(server);
    expect(settings.method).toBe(type);
    expect(settings[key]).toMatchObject(expected);
  });

  it('defaults to TLS and keeps the ids of tcp/ws/grpc links', () => {
    const link =
      'trojan://pass@tj.example.com:443?type=ws&sni=tj.example.com&path=%2Fws&host=cdn.example.com#Tj';
    const server = parseOne(link);
    expect(server.security).toBe('tls');
    // The id earlier builds gave this link.
    expect(server.uuid).toBe(
      createStableServerId(
        createHashedIdentityToken('tj', 'pass', 'tj.example.com', 443),
        'tj.example.com',
        443,
        [
          'ws',
          'tls',
          'tj.example.com',
          '',
          '/ws',
          'cdn.example.com',
          '',
          'false',
        ],
      ),
    );
  });
});

describe('Mux over XHTTP', () => {
  // An XHTTP inbound only lets UDP through Mux.Cool, so TCP would fail.
  it('stays off for XHTTP even when the user enabled Mux', () => {
    const server = parseOne(
      `vless://${UUID}@cdn.example.org:443?type=xhttp&security=tls&sni=cdn.example.org&path=%2Fx#X`,
    );
    const outbound = XrayConfigCompiler.compile(server, {
      logPath: '/tmp/xray.log',
      connectionMode: 'proxy',
      performanceSettings: {
        ...DEFAULT_PERFORMANCE_SETTINGS,
        muxEnabled: true,
      },
    }).outbounds[0];
    expect(outbound.mux).toEqual({ enabled: false });
  });

  it('is not forced on public Trojan over XHTTP, but still over RAW', () => {
    const xhttp = parseOne(
      'trojan://pass@cdn.example.org:443?sni=cdn.example.org&type=xhttp&path=%2Ftx#T',
    );
    expect(proxyOutbound(xhttp).mux).toEqual({ enabled: false });
    const raw = parseOne(
      'trojan://pass@cdn.example.org:443?sni=cdn.example.org#T',
    );
    expect(proxyOutbound(raw).mux).toMatchObject({ enabled: true });
  });
});

describe('share link TLS / transport parameters', () => {
  it('passes alpn through, so XHTTP can select HTTP/3', () => {
    const server = parseOne(
      `vless://${UUID}@cdn.example.org:443?type=xhttp&security=tls&sni=cdn.example.org&alpn=h3&path=%2Fh3&mode=auto#H3`,
    );
    expect(server.alpn).toEqual(['h3']);
    expect(stream(server).tlsSettings?.alpn).toEqual(['h3']);
  });

  it('keeps the per-transport ALPN default without an alpn parameter', () => {
    const ws = parseOne(
      `vless://${UUID}@cdn.example.org:443?type=ws&security=tls&sni=cdn.example.org#WS`,
    );
    expect(stream(ws).tlsSettings?.alpn).toEqual(['http/1.1']);
    const multi = parseOne(
      `trojan://pass@cdn.example.org:443?sni=cdn.example.org&alpn=h2%2Chttp%2F1.1#T`,
    );
    expect(stream(multi).tlsSettings?.alpn).toEqual(['h2', 'http/1.1']);
  });

  it('builds RAW HTTP camouflage from headerType=http', () => {
    const server = parseOne(
      `vless://${UUID}@cdn.example.org:443?type=tcp&security=tls&sni=cdn.example.org&headerType=http&host=bing.com%2Cwww.bing.com&path=%2Fa%2C%2Fb#HDR`,
    );
    const header = stream(server).rawSettings?.header as {
      type: string;
      request: { path: string[]; headers: Record<string, string[]> };
    };
    expect(header.type).toBe('http');
    expect(header.request.path).toEqual(['/a', '/b']);
    expect(header.request.headers.Host).toEqual(['bing.com', 'www.bing.com']);
    expect(header.request.headers['User-Agent']?.[0]).toMatch(/Chrome\/\d+/);
  });

  it('keeps Xray default headers when the link names no host', () => {
    const server = parseOne(
      `vless://${UUID}@cdn.example.org:443?type=tcp&security=tls&headerType=http#HDR`,
    );
    expect(stream(server).rawSettings?.header).toEqual({
      type: 'http',
      request: { version: '1.1', method: 'GET', path: ['/'] },
    });
  });

  it('ignores headerType outside RAW and keeps it for mKCP masks only', () => {
    const ws = parseOne(
      `vless://${UUID}@cdn.example.org:443?type=ws&security=tls&headerType=http#WS`,
    );
    expect(ws.headerType).toBeUndefined();
    expect(stream(ws).rawSettings).toBeUndefined();
  });

  it('maps gRPC mode=multi to multiMode', () => {
    const multi = parseOne(
      `vless://${UUID}@example.org:443?type=grpc&security=reality&sni=www.example.com&pbk=${PBK}&serviceName=g&mode=multi#G`,
    );
    expect(stream(multi).grpcSettings).toEqual({
      serviceName: 'g',
      multiMode: true,
    });
    const gun = parseOne(
      `vless://${UUID}@example.org:443?type=grpc&security=reality&sni=www.example.com&pbk=${PBK}&serviceName=g&mode=gun#G`,
    );
    expect(stream(gun).grpcSettings).toEqual({ serviceName: 'g' });
  });
});

describe('IPv6 share links', () => {
  it.each([
    `vless://${UUID}@[2001:db8::10]:443?type=tcp&security=reality&sni=www.example.com&pbk=${PBK}#V6`,
    'trojan://pass@[2001:db8::10]:443?sni=t.example.com#T6',
    'hy2://auth@[2001:db8::10]:443?sni=h.example.com#H6',
  ])('stores a bare IPv6 address for %s', (link) => {
    const server = parseOne(link);
    expect(server.address).toBe('2001:db8::10');
    // Ids keep the bracketed host, as before.
    expect(server.uuid).toContain('[2001:db8::10]:443');
  });
});

describe('fp=none', () => {
  // Xray rejects `none` ("unknown fingerprint") and defaults to chrome.
  it('falls back to the default fingerprint for TLS and REALITY links', () => {
    const tls = parseOne(
      `vless://${UUID}@cdn.example.org:443?type=tcp&security=tls&sni=cdn.example.org&fp=none#T`,
    );
    expect(stream(tls).tlsSettings?.fingerprint).toBe('chrome');
    const reality = parseOne(
      `vless://${UUID}@example.org:443?type=tcp&security=reality&sni=www.example.com&pbk=${PBK}&fp=none#R`,
    );
    expect(stream(reality).realitySettings?.fingerprint).toBe('chrome');
  });

  it('drops fingerprint "none" from raw JSON configs', () => {
    const outbound = proxyOutbound({
      uuid: 'raw',
      name: 'raw',
      address: 'cdn.example.org',
      port: 443,
      rawConfig: {
        outbounds: [
          {
            tag: 'proxy',
            protocol: 'vless',
            settings: { address: 'cdn.example.org', port: 443, id: UUID },
            streamSettings: {
              network: 'tcp',
              security: 'tls',
              tlsSettings: {
                serverName: 'cdn.example.org',
                fingerprint: 'none',
              },
            },
          },
        ],
      },
    });
    const settings = outbound.streamSettings as XrayStreamSettings;
    expect(settings.tlsSettings).toEqual({ serverName: 'cdn.example.org' });
  });
});

describe('insecure=1 next to its replacements', () => {
  const PIN =
    'f57cdcb0820ee009fa015211bb67db480d4f906c6124d58eb5c53084894ea7b6';

  it('accepts a Hysteria2 link that pins the certificate', () => {
    const server = parseOne(
      `hy2://auth@hy.example.org:443?sni=hy.example.org&insecure=1&pinSHA256=${PIN}#H`,
    );
    const tls = stream(server).tlsSettings as Record<string, unknown>;
    expect(tls.pinnedPeerCertSha256).toBe(PIN);
    expect(tls).not.toHaveProperty('allowInsecure');
  });

  it('accepts a link that verifies by name', () => {
    const server = parseOne(
      `vless://${UUID}@cdn.example.org:443?type=tcp&security=tls&sni=front.example.org&allowInsecure=1&vcn=cdn.example.org#V`,
    );
    expect(stream(server).tlsSettings?.verifyPeerCertByName).toBe(
      'cdn.example.org',
    );
  });

  it('still refuses insecure=1 alone', () => {
    const server = parseOne(
      `vless://${UUID}@cdn.example.org:443?type=tcp&security=tls&sni=cdn.example.org&insecure=1#V`,
    );
    expect(() => proxyOutbound(server)).toThrow(/"allowInsecure" was removed/);
  });

  it('strips allowInsecure from a raw config that pins the certificate', () => {
    const outbound = proxyOutbound({
      uuid: 'raw',
      name: 'raw',
      address: 'cdn.example.org',
      port: 443,
      rawConfig: {
        outbounds: [
          {
            tag: 'proxy',
            protocol: 'trojan',
            settings: { address: 'cdn.example.org', port: 443, password: 'p' },
            streamSettings: {
              security: 'tls',
              tlsSettings: {
                serverName: 'cdn.example.org',
                allowInsecure: true,
                pinnedPeerCertSha256: PIN,
              },
            },
          },
        ],
      },
    });
    const tls = (outbound.streamSettings as XrayStreamSettings).tlsSettings;
    expect(tls).toMatchObject({ pinnedPeerCertSha256: PIN });
    expect(tls).not.toHaveProperty('allowInsecure');
  });
});

describe('links the client cannot build', () => {
  it('defaults the Trojan port to 443 (Trojan-Go URL scheme)', () => {
    expect(
      parseOne('trojan://pass@tj.example.com?sni=tj.example.com#T'),
    ).toMatchObject({
      address: 'tj.example.com',
      port: 443,
    });
  });

  const ssUser = Buffer.from('aes-256-gcm:pw').toString('base64url');
  const ss = (plugin: string) =>
    `ss://${ssUser}@ss.example.com:443?plugin=${encodeURIComponent(plugin)}#S`;

  it('maps v2ray-plugin to WebSocket, its default mode', () => {
    const plain = parseOne(ss('v2ray-plugin;host=cdn.example.com;path=/s'));
    expect(stream(plain)).toMatchObject({
      method: 'websocket',
      security: 'none',
      wsSettings: { path: '/s', host: 'cdn.example.com' },
    });
    const tls = parseOne(ss('v2ray-plugin;tls;host=cdn.example.com'));
    expect(stream(tls)).toMatchObject({ method: 'websocket', security: 'tls' });
  });

  it.each([
    'obfs-local;obfs=http;obfs-host=bing.com',
    'simple-obfs;obfs=tls',
    'v2ray-plugin;mode=quic;host=cdn.example.com',
    'kcptun;mode=fast2',
  ])('skips a Shadowsocks link with plugin %s', (plugin) => {
    expect(parseDirectLinksFromText(ss(plugin))).toEqual([]);
  });

  it('turns type=h2 into http, which the compiler explains', () => {
    const server = parseOne(
      `vless://${UUID}@cdn.example.org:443?type=h2&security=tls&sni=cdn.example.org#H2`,
    );
    expect(server.type).toBe('http');
    expect(() => proxyOutbound(server)).toThrow(/use XHTTP instead/);
  });

  it('skips a link with a transport the client does not know', () => {
    expect(
      parseDirectLinksFromText(
        `vless://${UUID}@cdn.example.org:443?type=xdrive&security=none&encryption=x#X`,
      ),
    ).toEqual([]);
  });

  it('reads the transport name case-insensitively', () => {
    const server = parseOne(
      `vless://${UUID}@cdn.example.org:443?type=WS&security=tls&sni=cdn.example.org#W`,
    );
    expect(stream(server).method).toBe('websocket');
  });
});
