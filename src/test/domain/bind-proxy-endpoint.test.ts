import { describe, expect, it } from 'vitest';
import { makeServer } from '@/test/factories';
import type { XrayConfig } from '@/shared/xray-types';
import { bindProxyEndpointToIp } from '@/main/domain/connection/bindProxyEndpoint';
import { XrayConfigCompiler } from '@/main/services/XrayConfigCompiler';

function compileProxy(server: ReturnType<typeof makeServer>) {
  const config = XrayConfigCompiler.compile(server, {
    logPath: '/tmp/xray.log',
    connectionMode: 'tun',
  });
  return config.outbounds.find((outbound) => outbound.tag === 'proxy')!;
}

function rawWsOutbound(stream: Record<string, unknown>): XrayConfig {
  return {
    outbounds: [
      {
        tag: 'proxy',
        protocol: 'vless',
        settings: {
          vnext: [
            {
              address: 'cdn.example.com',
              port: 443,
              users: [{ id: '00000000-0000-0000-0000-000000000001' }],
            },
          ],
        },
        streamSettings: {
          network: 'ws',
          wsSettings: { path: '/ws' },
          ...stream,
        },
      },
    ],
  } as XrayConfig;
}

describe('bindProxyEndpointToIp', () => {
  it('rewrites structured address and leaves SNI alone', () => {
    const server = makeServer({
      address: 'oauth.example.com',
      sni: 'oauth.example.com',
      security: 'reality',
    });
    const bound = bindProxyEndpointToIp(server, '203.0.113.10');
    expect(bound.address).toBe('203.0.113.10');
    expect(bound.sni).toBe('oauth.example.com');
  });

  it('rewrites raw vnext address but keeps REALITY serverName', () => {
    const server = makeServer({
      address: 'oauth.example.com',
      security: 'reality',
      pbk: 'public-key',
      rawConfig: {
        outbounds: [
          {
            tag: 'proxy',
            protocol: 'vless',
            settings: {
              vnext: [
                {
                  address: 'oauth.example.com',
                  port: 443,
                  users: [
                    {
                      id: '00000000-0000-0000-0000-000000000001',
                      encryption: 'none',
                      flow: 'xtls-rprx-vision',
                    },
                  ],
                },
              ],
            },
            streamSettings: {
              network: 'tcp',
              security: 'reality',
              realitySettings: {
                serverName: 'oauth.example.com',
                publicKey: 'public-key',
              },
            },
          },
        ],
      } as XrayConfig,
    });

    const bound = bindProxyEndpointToIp(server, '198.51.100.7');
    const proxy = bound.rawConfig?.outbounds?.[0] as {
      settings: { vnext: Array<{ address: string }> };
      streamSettings: { realitySettings: { serverName: string } };
    };
    expect(bound.address).toBe('198.51.100.7');
    expect(proxy.settings.vnext[0].address).toBe('198.51.100.7');
    expect(proxy.streamSettings.realitySettings.serverName).toBe(
      'oauth.example.com',
    );
  });

  it('keeps the domain as TLS server name and WS host when the link has no sni', () => {
    const server = makeServer({
      address: 'cdn.example.com',
      security: 'tls',
      type: 'ws',
      path: '/ws',
    });
    const proxy = compileProxy(bindProxyEndpointToIp(server, '203.0.113.10'));
    expect(proxy.settings).toMatchObject({ address: '203.0.113.10' });
    expect(proxy.streamSettings?.tlsSettings?.serverName).toBe(
      'cdn.example.com',
    );
    expect(proxy.streamSettings?.wsSettings).toMatchObject({
      host: 'cdn.example.com',
    });
  });

  it('keeps the domain as Trojan server name', () => {
    const server = makeServer({
      address: 'cdn.example.com',
      protocol: 'trojan',
      password: 'secret',
      security: 'tls',
    });
    const proxy = compileProxy(bindProxyEndpointToIp(server, '203.0.113.10'));
    expect(proxy.streamSettings?.tlsSettings?.serverName).toBe(
      'cdn.example.com',
    );
  });

  it('leaves an explicit sni and IP endpoints alone', () => {
    const explicit = bindProxyEndpointToIp(
      makeServer({ address: 'cdn.example.com', sni: 'front.example.net' }),
      '203.0.113.10',
    );
    expect(explicit.sni).toBe('front.example.net');
    const ipOnly = bindProxyEndpointToIp(
      makeServer({ address: '198.51.100.1' }),
      '198.51.100.1',
    );
    expect(ipOnly.sni).toBeUndefined();
  });

  it('fills an empty raw TLS server name and WS host from the vnext domain', () => {
    const server = makeServer({
      address: 'cdn.example.com',
      rawConfig: rawWsOutbound({ security: 'tls', tlsSettings: {} }),
    });
    const outbound = bindProxyEndpointToIp(server, '203.0.113.10').rawConfig
      ?.outbounds?.[0] as {
      settings: { vnext: Array<{ address: string }> };
      streamSettings: {
        tlsSettings: { serverName: string };
        wsSettings: { host: string };
      };
    };
    expect(outbound.settings.vnext[0].address).toBe('203.0.113.10');
    expect(outbound.streamSettings.tlsSettings.serverName).toBe(
      'cdn.example.com',
    );
    expect(outbound.streamSettings.wsSettings.host).toBe('cdn.example.com');
  });

  it('uses the raw TLS server name, not the address, as the WS host', () => {
    const server = makeServer({
      address: 'cdn.example.com',
      rawConfig: rawWsOutbound({
        security: 'tls',
        tlsSettings: { serverName: 'front.example.net' },
      }),
    });
    const outbound = bindProxyEndpointToIp(server, '203.0.113.10').rawConfig
      ?.outbounds?.[0] as { streamSettings: { wsSettings: { host: string } } };
    expect(outbound.streamSettings.wsSettings.host).toBe('front.example.net');
  });

  it('keeps a raw Host header and fills plain WS host from the domain', () => {
    const withHeader = bindProxyEndpointToIp(
      makeServer({
        address: 'cdn.example.com',
        rawConfig: rawWsOutbound({
          wsSettings: { path: '/ws', headers: { Host: 'h.example.org' } },
        }),
      }),
      '203.0.113.10',
    ).rawConfig?.outbounds?.[0] as {
      streamSettings: { wsSettings: Record<string, unknown> };
    };
    expect(withHeader.streamSettings.wsSettings.host).toBeUndefined();

    const plain = bindProxyEndpointToIp(
      makeServer({ address: 'cdn.example.com', rawConfig: rawWsOutbound({}) }),
      '203.0.113.10',
    ).rawConfig?.outbounds?.[0] as {
      streamSettings: { wsSettings: { host: string } };
    };
    expect(plain.streamSettings.wsSettings.host).toBe('cdn.example.com');
  });
});
