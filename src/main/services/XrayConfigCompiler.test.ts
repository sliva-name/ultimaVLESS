import { describe, expect, it } from 'vitest';
import { makeServer } from '@/test/factories';
import { DEFAULT_PERFORMANCE_SETTINGS } from '@/shared/types';
import type { XrayConfig } from '@/shared/xray-types';
import { XrayConfigCompiler } from './XrayConfigCompiler';

describe('XrayConfigCompiler', () => {
  it('compiles a structured server profile into a runnable Xray config', () => {
    const config = XrayConfigCompiler.compile(
      makeServer({
        security: 'reality',
        sni: 'example.com',
        pbk: 'public-key',
      }),
      {
        logPath: '/tmp/xray.log',
        connectionMode: 'proxy',
      },
    );

    expect(config.log.access).toBe('/tmp/xray.log');
    expect(config.inbounds).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ protocol: 'socks' }),
        expect.objectContaining({ protocol: 'http' }),
      ]),
    );
    expect(config.outbounds[0]).toMatchObject({
      tag: 'proxy',
      protocol: 'vless',
      settings: {
        address: 'example.com',
        port: 443,
        encryption: 'none',
      },
      streamSettings: {
        method: 'raw',
        network: 'tcp',
        security: 'reality',
      },
    });
    expect(config.outbounds[0].settings).not.toHaveProperty('vnext');
  });

  it('uses autoOutboundsInterface without sendThrough when tunAutoRoute is on', () => {
    const config = XrayConfigCompiler.compile(
      makeServer({ security: 'tls', sni: 'example.com' }),
      {
        logPath: '/tmp/xray.log',
        connectionMode: 'tun',
        sendThrough: '192.168.1.10',
        tunAutoRoute: true,
      },
    );

    const tunInbound = config.inbounds?.find(
      (inbound) => inbound.protocol === 'tun',
    );
    expect(tunInbound).toMatchObject({
      protocol: 'tun',
      settings: expect.objectContaining({
        mtu: 1500,
        gateway: expect.any(Array),
        autoSystemRoutingTable: ['0.0.0.0/0', '::/0'],
        autoOutboundsInterface: 'auto',
        dns: ['1.1.1.1', '1.0.0.1'],
      }),
    });
    expect(config.outbounds[0].sendThrough).toBeUndefined();
    expect(config.outbounds.some((o) => o.tag === 'dns-out')).toBe(true);
    expect(config.routing?.rules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          port: '53',
          network: 'udp,tcp',
          outboundTag: 'dns-out',
        }),
      ]),
    );
  });

  it('applies remote DNS without localhost and hijacks port 53 in TUN mode', () => {
    const config = XrayConfigCompiler.compile(
      makeServer({ security: 'tls', sni: 'example.com' }),
      {
        logPath: '/tmp/xray.log',
        connectionMode: 'tun',
        tunAutoRoute: true,
        performanceSettings: {
          ...DEFAULT_PERFORMANCE_SETTINGS,
          remoteDnsPreset: 'google',
          remoteDnsServers: ['8.8.8.8', '8.8.4.4'],
        },
      },
    );

    expect(config.dns).toMatchObject({
      queryStrategy: 'UseIPv4',
      servers: ['8.8.8.8', '8.8.4.4'],
    });
    expect(config.dns?.servers).not.toContain('localhost');
    const tunInbound = config.inbounds?.find((i) => i.protocol === 'tun');
    expect(tunInbound?.settings).toMatchObject({
      dns: ['8.8.8.8', '8.8.4.4'],
    });
    expect(
      config.outbounds.find((o) => o.tag === 'dns-out')?.settings,
    ).toMatchObject({
      rewriteAddress: '8.8.8.8',
      rewritePort: 53,
    });
  });

  it('replaces subscription DNS with remote settings in TUN mode', () => {
    const config = XrayConfigCompiler.compile(
      makeServer({
        security: 'reality',
        sni: 'example.com',
        pbk: 'public-key',
        rawConfig: {
          dns: {
            servers: ['8.8.8.8', '8.8.4.4'],
            queryStrategy: 'UseIP',
          },
          inbounds: [],
          outbounds: [
            {
              tag: 'proxy',
              protocol: 'vless',
              settings: {
                address: 'example.com',
                port: 443,
                id: '00000000-0000-0000-0000-000000000001',
                encryption: 'none',
              },
              streamSettings: {
                network: 'tcp',
                security: 'reality',
                realitySettings: {
                  serverName: 'example.com',
                  publicKey: 'public-key',
                },
              },
            },
            { tag: 'direct', protocol: 'freedom' },
            { tag: 'block', protocol: 'blackhole' },
          ],
          routing: { rules: [] },
        } as XrayConfig,
      }),
      {
        logPath: '/tmp/xray.log',
        connectionMode: 'tun',
        tunAutoRoute: true,
      },
    );

    expect(config.dns).toMatchObject({
      queryStrategy: 'UseIPv4',
      servers: ['1.1.1.1', '1.0.0.1'],
    });
    expect(config.dns?.servers).not.toContain('localhost');
    expect(config.outbounds.some((o) => o.tag === 'dns-out')).toBe(true);
  });

  it('applies remote DNS in proxy mode without dns-out hijack', () => {
    const config = XrayConfigCompiler.compile(
      makeServer({ security: 'tls', sni: 'example.com' }),
      {
        logPath: '/tmp/xray.log',
        connectionMode: 'proxy',
        performanceSettings: {
          ...DEFAULT_PERFORMANCE_SETTINGS,
          remoteDnsPreset: 'quad9',
          remoteDnsServers: ['9.9.9.9', '149.112.112.112'],
        },
      },
    );

    expect(config.dns).toMatchObject({
      servers: ['9.9.9.9', '149.112.112.112'],
      queryStrategy: 'UseIPv4',
    });
    expect(config.outbounds.some((o) => o.tag === 'dns-out')).toBe(false);
  });

  it('disables mux for Vision outbounds even when raw config enables XUDP mux', () => {
    const config = XrayConfigCompiler.compile(
      makeServer({
        security: 'reality',
        sni: 'example.com',
        pbk: 'public-key',
        flow: 'xtls-rprx-vision',
        rawConfig: {
          dns: { servers: ['8.8.8.8'], queryStrategy: 'UseIP' },
          inbounds: [],
          outbounds: [
            {
              tag: 'proxy',
              protocol: 'vless',
              settings: {
                vnext: [
                  {
                    address: 'example.com',
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
                  serverName: 'example.com',
                  publicKey: 'public-key',
                },
              },
              mux: {
                enabled: true,
                concurrency: -1,
                xudpConcurrency: 16,
              },
            },
            { tag: 'direct', protocol: 'freedom' },
            { tag: 'block', protocol: 'blackhole' },
          ],
          routing: { rules: [] },
        } as XrayConfig,
      }),
      {
        logPath: '/tmp/xray.log',
        connectionMode: 'tun',
        tunAutoRoute: true,
      },
    );

    expect(config.outbounds[0].mux).toEqual({ enabled: false });
  });

  it('keeps sendThrough when tunAutoRoute is off (PowerShell fallback)', () => {
    const config = XrayConfigCompiler.compile(
      makeServer({ security: 'tls', sni: 'example.com' }),
      {
        logPath: '/tmp/xray.log',
        connectionMode: 'tun',
        sendThrough: '192.168.1.10',
        tunAutoRoute: false,
      },
    );

    const tunInbound = config.inbounds?.find(
      (inbound) => inbound.protocol === 'tun',
    );
    // Loop prevention must stay on even when PowerShell owns the route table.
    expect(tunInbound?.settings).toMatchObject({
      autoOutboundsInterface: 'auto',
    });
    expect(tunInbound?.settings).not.toHaveProperty('autoSystemRoutingTable');
    expect(config.outbounds[0].sendThrough).toBe('192.168.1.10');
    const direct = config.outbounds.find((outbound) => outbound.tag === 'direct');
    expect(direct?.sendThrough).toBe('192.168.1.10');
  });

  it('rejects unencrypted public VLESS profiles before spawning Xray', () => {
    expect(() =>
      XrayConfigCompiler.compile(makeServer({ security: 'none' }), {
        logPath: '/tmp/xray.log',
        connectionMode: 'proxy',
      }),
    ).toThrow(/TLS\/REALITY/);
  });

  it('applies xhttpMaxConnections into xmux and drops conflicting maxConcurrency', () => {
    const config = XrayConfigCompiler.compile(
      makeServer({
        security: 'tls',
        sni: 'example.com',
        type: 'xhttp',
        path: '/x',
        xhttpExtra: {
          xmux: { maxConcurrency: 8, hMaxRequestTimes: 100 },
        },
      }),
      {
        logPath: '/tmp/xray.log',
        connectionMode: 'proxy',
        performanceSettings: {
          ...DEFAULT_PERFORMANCE_SETTINGS,
          xhttpMaxConnections: 6,
        },
      },
    );

    expect(config.outbounds[0].streamSettings?.xhttpSettings?.extra).toEqual({
      xmux: {
        hMaxRequestTimes: 100,
        maxConnections: 6,
      },
    });
  });

  it('forces Mux for public Trojan outbounds (anti-TiT)', () => {
    const config = XrayConfigCompiler.compile(
      makeServer({
        protocol: 'trojan',
        password: 'secret',
        security: 'tls',
        sni: 'example.com',
      }),
      {
        logPath: '/tmp/xray.log',
        connectionMode: 'proxy',
        performanceSettings: {
          muxEnabled: false,
          muxConcurrency: 8,
          xudpConcurrency: 16,
          xudpProxyUDP443: 'reject',
          xhttpMaxConnections: 3,
          remoteDnsPreset: 'cloudflare',
          remoteDnsServers: ['1.1.1.1', '1.0.0.1'],
          tcpFastOpen: true,
          sniffingRouteOnly: true,
          logLevel: 'warning',
          fingerprint: 'chrome',
          blockAds: false,
          blockBittorrent: false,
          domainStrategy: 'AsIs',
          windowsTunRouting: 'xray',
        },
      },
    );

    expect(config.outbounds[0].mux).toMatchObject({
      enabled: true,
      concurrency: 8,
    });
  });

  it('uses http/1.1 ALPN for WebSocket TLS', () => {
    const config = XrayConfigCompiler.compile(
      makeServer({
        security: 'tls',
        sni: 'example.com',
        type: 'ws',
        path: '/ws',
        host: 'example.com',
      }),
      {
        logPath: '/tmp/xray.log',
        connectionMode: 'proxy',
      },
    );

    expect(config.outbounds[0].streamSettings).toMatchObject({
      method: 'websocket',
      tlsSettings: { alpn: ['http/1.1'] },
    });
  });

  it('coerces removed VMess security and maps stream method alias in raw configs', () => {
    const rawConfig: XrayConfig = {
      log: { loglevel: 'warning' },
      inbounds: [],
      outbounds: [
        {
          tag: 'proxy',
          protocol: 'vmess',
          settings: {
            address: 'example.com',
            port: 443,
            id: '11111111-1111-1111-1111-111111111111',
            security: 'none',
          },
          streamSettings: {
            method: 'tcp',
            security: 'tls',
            tlsSettings: { serverName: 'example.com' },
          },
        },
      ],
    };

    const config = XrayConfigCompiler.compile(
      makeServer({
        rawConfig,
        security: 'tls',
      }),
      {
        logPath: '/tmp/xray.log',
        connectionMode: 'proxy',
      },
    );

    const proxy = config.outbounds.find((outbound) => outbound.tag === 'proxy');
    expect(proxy?.settings?.security).toBe('auto');
    expect(proxy?.streamSettings).toMatchObject({
      network: 'tcp',
      method: 'raw',
    });
  });

  it('rejects Shadowsocks none/plain methods', () => {
    expect(() =>
      XrayConfigCompiler.compile(
        makeServer({
          protocol: 'shadowsocks',
          method: 'none',
          password: 'secret',
          security: 'none',
        }),
        {
          logPath: '/tmp/xray.log',
          connectionMode: 'proxy',
        },
      ),
    ).toThrow(/Shadowsocks method "none"/);
  });

  it('compiles Hysteria2 with TLS auth and salamander finalmask', () => {
    const config = XrayConfigCompiler.compile(
      makeServer({
        protocol: 'hysteria',
        hysteriaAuth: 'auth-token',
        type: 'hysteria',
        security: 'tls',
        sni: 'hy.example.com',
        echConfigList: 'AEn+DQB...',
        hysteriaObfs: { type: 'salamander', password: 'obfs-pass' },
      }),
      {
        logPath: '/tmp/xray.log',
        connectionMode: 'proxy',
      },
    );

    expect(config.version).toMatchObject({ min: '26.7.28' });
    expect(config.outbounds[0]).toMatchObject({
      protocol: 'hysteria',
      settings: {
        version: 2,
        address: 'example.com',
        port: 443,
      },
      streamSettings: {
        method: 'hysteria',
        security: 'tls',
        hysteriaSettings: { version: 2, auth: 'auth-token' },
        tlsSettings: {
          serverName: 'hy.example.com',
          echConfigList: 'AEn+DQB...',
        },
        finalmask: {
          udp: [{ type: 'salamander', settings: { password: 'obfs-pass' } }],
        },
      },
      mux: { enabled: false },
    });
  });

  it('compiles WireGuard without streamSettings or mux', () => {
    const config = XrayConfigCompiler.compile(
      makeServer({
        protocol: 'wireguard',
        wgSecretKey: 'client-secret',
        wgAddress: ['10.0.0.2/32'],
        wgPeers: [
          {
            endpoint: 'wg.example.com:51820',
            publicKey: 'server-public',
            allowedIPs: ['0.0.0.0/0'],
          },
        ],
        wgMtu: 1420,
      }),
      {
        logPath: '/tmp/xray.log',
        connectionMode: 'proxy',
      },
    );

    expect(config.version).toMatchObject({ min: '26.7.28' });
    expect(config.outbounds[0]).toMatchObject({
      protocol: 'wireguard',
      settings: {
        secretKey: 'client-secret',
        address: ['10.0.0.2/32'],
        mtu: 1420,
        peers: [
          {
            endpoint: 'wg.example.com:51820',
            publicKey: 'server-public',
            allowedIPs: ['0.0.0.0/0'],
          },
        ],
      },
    });
    expect(config.outbounds[0].streamSettings).toBeUndefined();
    expect(config.outbounds[0].mux).toBeUndefined();
  });

  it('emits REALITY mldsa65Verify and TLS echConfigList', () => {
    const reality = XrayConfigCompiler.compile(
      makeServer({
        security: 'reality',
        sni: 'example.com',
        pbk: 'public-key',
        mldsa65Verify: 'pq-verify-key',
      }),
      {
        logPath: '/tmp/xray.log',
        connectionMode: 'proxy',
      },
    );
    expect(reality.outbounds[0].streamSettings?.realitySettings).toMatchObject({
      mldsa65Verify: 'pq-verify-key',
    });

    const tls = XrayConfigCompiler.compile(
      makeServer({
        security: 'tls',
        sni: 'example.com',
        echConfigList: 'ech-blob',
        finalmask: { tcp: [{ type: 'custom' }] },
      }),
      {
        logPath: '/tmp/xray.log',
        connectionMode: 'proxy',
      },
    );
    expect(tls.outbounds[0].streamSettings?.tlsSettings).toMatchObject({
      echConfigList: 'ech-blob',
    });
    expect(tls.outbounds[0].streamSettings?.finalmask).toEqual({
      tcp: [{ type: 'custom' }],
    });
  });

  it('preserves version.max from raw configs while pinning min', () => {
    const config = XrayConfigCompiler.compile(
      makeServer({
        rawConfig: {
          log: { loglevel: 'warning' },
          version: { max: '99.0.0' },
          inbounds: [],
          outbounds: [
            {
              tag: 'proxy',
              protocol: 'vless',
              settings: {
                address: 'example.com',
                port: 443,
                id: '11111111-1111-1111-1111-111111111111',
                encryption: 'none',
              },
              streamSettings: {
                method: 'raw',
                security: 'tls',
                tlsSettings: { serverName: 'example.com' },
              },
            },
          ],
        },
      }),
      {
        logPath: '/tmp/xray.log',
        connectionMode: 'proxy',
      },
    );

    expect(config.version).toEqual({ min: '26.7.28', max: '99.0.0' });
  });
});
