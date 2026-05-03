import { describe, expect, it } from 'vitest';
import { ConfigGenerator } from './ConfigGenerator';
import { makeServer } from '@/test/factories';
import { DEFAULT_PERFORMANCE_SETTINGS } from '@/shared/types';

describe('ConfigGenerator', () => {
  const baseConfig = makeServer({
    uuid: '123-uuid',
    name: 'Test Server',
    type: 'tcp',
    security: 'reality',
    flow: 'xtls-rprx-vision',
    sni: 'example.com',
    fp: 'chrome',
    pbk: 'public-key',
    sid: 'short-id',
  });

  function getTunInbound(result: any) {
    return result.inbounds?.find((inbound: any) => inbound.tag === 'tun-in');
  }

  it('generates reality outbound settings from server fields', () => {
    const result = ConfigGenerator.generate(baseConfig, '/tmp/xray.log');

    expect(result.log.access).toBe('/tmp/xray.log');
    expect(result.outbounds[0]).toMatchObject({
      protocol: 'vless',
      streamSettings: {
        security: 'reality',
        realitySettings: {
          password: 'public-key',
          shortId: 'short-id',
        },
      },
    });
  });

  it('generates tls settings when tls security is requested', () => {
    const result = ConfigGenerator.generate(
      makeServer({
        ...baseConfig,
        security: 'tls',
        sid: undefined,
        pbk: undefined,
        fp: undefined,
      }),
      '/tmp/log',
    );

    expect(result.outbounds[0].streamSettings).toMatchObject({
      security: 'tls',
      tlsSettings: {
        serverName: 'example.com',
      },
    });
  });

  it('uses the default reality fingerprint when fp is missing', () => {
    const result = ConfigGenerator.generate(
      makeServer({ ...baseConfig, fp: undefined }),
      '/tmp/log',
    );

    expect(
      result.outbounds[0].streamSettings?.realitySettings?.fingerprint,
    ).toBe('chrome');
  });

  it('omits empty flow on the VLESS user object', () => {
    const result = ConfigGenerator.generate(
      makeServer({ ...baseConfig, flow: undefined }),
      '/tmp/log',
    );
    const user = (result.outbounds[0] as any).settings.vnext[0].users[0];
    expect(user.flow).toBeUndefined();
    expect(user.encryption).toBe('none');
  });

  it('disables TCP mux but enables XUDP when xtls-rprx-vision flow is set', () => {
    const result = ConfigGenerator.generate(baseConfig, '/tmp/log');
    const mux = result.outbounds[0].mux;

    expect(mux).toEqual({
      enabled: true,
      concurrency: -1,
      xudpConcurrency: 16,
      xudpProxyUDP443: 'reject',
    });
  });

  it('enables full mux when no flow is set', () => {
    const result = ConfigGenerator.generate(
      makeServer({ ...baseConfig, flow: undefined }),
      '/tmp/log',
    );
    const mux = result.outbounds[0].mux;

    expect(mux).toMatchObject({
      enabled: true,
      concurrency: 8,
      xudpConcurrency: 16,
    });
  });

  it('places mux at outbound level, not inside streamSettings', () => {
    const result = ConfigGenerator.generate(baseConfig, '/tmp/log');

    expect(result.outbounds[0].mux).toBeDefined();
    expect((result.outbounds[0].streamSettings as any)?.mux).toBeUndefined();
  });

  it('includes sockopt with tcpFastOpen on outbound', () => {
    const result = ConfigGenerator.generate(baseConfig, '/tmp/log');
    expect(result.outbounds[0].streamSettings?.sockopt?.tcpFastOpen).toBe(true);
  });

  it('sets routeOnly on socks inbound sniffing', () => {
    const result = ConfigGenerator.generate(baseConfig, '/tmp/log');
    const socksInbound = result.inbounds?.find(
      (ib: any) => ib.protocol === 'socks',
    );
    expect(socksInbound?.sniffing?.routeOnly).toBe(true);
  });

  it('adds kcpSettings for kcp transport', () => {
    const result = ConfigGenerator.generate(
      makeServer({ ...baseConfig, type: 'kcp', security: 'none' }),
      '/tmp/log',
    );
    expect(result.outbounds[0].streamSettings?.network).toBe('kcp');
    expect(result.outbounds[0].streamSettings?.kcpSettings?.header).toEqual({
      type: 'none',
    });
  });

  it('adds httpSettings for http transport', () => {
    const result = ConfigGenerator.generate(
      makeServer({
        ...baseConfig,
        type: 'http',
        security: 'tls',
        path: '/p',
        host: 'cdn.test',
      }),
      '/tmp/log',
    );
    expect(result.outbounds[0].streamSettings?.httpSettings).toEqual({
      path: '/p',
      host: ['cdn.test'],
    });
  });

  it('adds quicSettings for quic transport', () => {
    const result = ConfigGenerator.generate(
      makeServer({ ...baseConfig, type: 'quic', security: 'tls' }),
      '/tmp/log',
    );
    expect(result.outbounds[0].streamSettings?.network).toBe('quic');
    expect(result.outbounds[0].streamSettings?.quicSettings?.header).toEqual({
      type: 'none',
    });
  });

  it('routes bittorrent traffic to the block outbound', () => {
    const result = ConfigGenerator.generate(baseConfig, '/tmp/log');

    expect(
      result.routing.rules.some(
        (rule: any) =>
          rule.protocol?.includes('bittorrent') && rule.outboundTag === 'block',
      ),
    ).toBe(true);
  });

  it('omits bittorrent block rule when blockBittorrent is false', () => {
    const result = ConfigGenerator.generate(baseConfig, '/tmp/log', 'proxy', {
      performanceSettings: {
        ...DEFAULT_PERFORMANCE_SETTINGS,
        blockBittorrent: false,
      },
    });
    expect(
      result.routing.rules.some((rule: any) =>
        rule.protocol?.includes('bittorrent'),
      ),
    ).toBe(false);
  });

  it('omits ad-block rule when blockAds is false', () => {
    const result = ConfigGenerator.generate(baseConfig, '/tmp/log', 'proxy', {
      performanceSettings: { ...DEFAULT_PERFORMANCE_SETTINGS, blockAds: false },
    });
    expect(
      result.routing.rules.some((rule: any) =>
        rule.domain?.includes('geosite:category-ads-all'),
      ),
    ).toBe(false);
  });

  it('uses custom log level from performance settings', () => {
    const result = ConfigGenerator.generate(baseConfig, '/tmp/log', 'proxy', {
      performanceSettings: {
        ...DEFAULT_PERFORMANCE_SETTINGS,
        logLevel: 'debug',
      },
    });
    expect(result.log.loglevel).toBe('debug');
  });

  it('uses custom domain strategy from performance settings', () => {
    const result = ConfigGenerator.generate(baseConfig, '/tmp/log', 'proxy', {
      performanceSettings: {
        ...DEFAULT_PERFORMANCE_SETTINGS,
        domainStrategy: 'AsIs',
      },
    });
    expect(result.routing.domainStrategy).toBe('AsIs');
  });

  it('uses custom fingerprint when server fp is not set', () => {
    const noFpConfig = makeServer({ ...baseConfig, fp: undefined });
    const result = ConfigGenerator.generate(noFpConfig, '/tmp/log', 'proxy', {
      performanceSettings: {
        ...DEFAULT_PERFORMANCE_SETTINGS,
        fingerprint: 'firefox',
      },
    });
    expect(
      result.outbounds[0].streamSettings?.realitySettings?.fingerprint,
    ).toBe('firefox');
  });

  it('prefers server fp over default fingerprint setting', () => {
    const result = ConfigGenerator.generate(baseConfig, '/tmp/log', 'proxy', {
      performanceSettings: {
        ...DEFAULT_PERFORMANCE_SETTINGS,
        fingerprint: 'firefox',
      },
    });
    expect(
      result.outbounds[0].streamSettings?.realitySettings?.fingerprint,
    ).toBe('chrome');
  });

  it('adds tun-specific settings when tun mode is enabled', () => {
    const result = ConfigGenerator.generate(baseConfig, '/tmp/log', 'tun', {
      sendThrough: '192.168.1.10',
      tunAutoRoute: true,
    });
    const tunInbound = getTunInbound(result);

    expect(tunInbound.settings).toMatchObject({
      name: 'ultima0',
      mtu: 1500,
      gateway: ['172.19.0.1/30', 'fd7a:115c:a1e0::1/126'],
      dns: [
        '1.1.1.1',
        '8.8.8.8',
        '2606:4700:4700::1111',
        '2001:4860:4860::8888',
      ],
      autoSystemRoutingTable: ['0.0.0.0/0', '::/0'],
      autoOutboundsInterface: 'auto',
    });
    expect((tunInbound.settings as any).inet4_address).toBeUndefined();
    expect((tunInbound.settings as any).autoRoute).toBeUndefined();
    expect((tunInbound.settings as any).strictRoute).toBeUndefined();
    expect((tunInbound.settings as any).MTU).toBeUndefined();
    expect(result.outbounds[0].sendThrough).toBe('192.168.1.10');
  });

  it('does not duplicate an existing tun inbound in raw configs', () => {
    const result = ConfigGenerator.generate(
      makeServer({
        ...baseConfig,
        rawConfig: {
          inbounds: [
            {
              tag: 'existing-tun',
              protocol: 'tun',
              settings: { name: 'existing0' },
            },
          ],
          outbounds: [{ tag: 'proxy', protocol: 'vless', settings: {} }],
        },
      }),
      '/tmp/log',
      'tun',
      { tunAutoRoute: true },
    );

    const tunInbounds = result.inbounds.filter(
      (inbound: any) => inbound.protocol === 'tun',
    );
    expect(tunInbounds).toHaveLength(1);
    expect(tunInbounds[0].tag).toBe('existing-tun');
  });

  it('applies sockopt and mux to raw config outbounds', () => {
    const result = ConfigGenerator.generate(
      makeServer({
        ...baseConfig,
        rawConfig: {
          inbounds: [],
          outbounds: [
            {
              tag: 'proxy',
              protocol: 'vless',
              settings: {
                vnext: [{ users: [{ id: 'x', encryption: 'none' }] }],
              },
            },
            { tag: 'direct', protocol: 'freedom' },
          ],
        },
      }),
      '/tmp/log',
    );

    const proxy = result.outbounds.find((o: any) => o.tag === 'proxy');
    expect(proxy.streamSettings.sockopt.tcpFastOpen).toBe(true);
    expect(proxy.mux).toBeDefined();
    expect(proxy.mux.enabled).toBe(true);
    expect(proxy.mux.concurrency).toBe(8);

    const direct = result.outbounds.find((o: any) => o.tag === 'direct');
    expect(direct.mux).toBeUndefined();
  });

  it('disables TCP mux for raw config outbounds with Vision flow', () => {
    const result = ConfigGenerator.generate(
      makeServer({
        ...baseConfig,
        rawConfig: {
          inbounds: [],
          outbounds: [
            {
              tag: 'proxy',
              protocol: 'vless',
              settings: {
                vnext: [
                  {
                    users: [
                      { id: 'x', encryption: 'none', flow: 'xtls-rprx-vision' },
                    ],
                  },
                ],
              },
            },
          ],
        },
      }),
      '/tmp/log',
    );

    const proxy = result.outbounds[0];
    expect(proxy.mux.concurrency).toBe(-1);
  });

  it('does not overwrite existing mux/sockopt in raw configs', () => {
    const result = ConfigGenerator.generate(
      makeServer({
        ...baseConfig,
        rawConfig: {
          inbounds: [],
          outbounds: [
            {
              tag: 'proxy',
              protocol: 'vless',
              settings: {
                vnext: [{ users: [{ id: 'x', encryption: 'none' }] }],
              },
              streamSettings: { sockopt: { tcpFastOpen: false, mark: 255 } },
              mux: { enabled: false, concurrency: 1 },
            },
          ],
        },
      }),
      '/tmp/log',
    );

    const proxy = result.outbounds[0];
    expect(proxy.streamSettings.sockopt.tcpFastOpen).toBe(false);
    expect(proxy.streamSettings.sockopt.mark).toBe(255);
    expect(proxy.mux.enabled).toBe(false);
  });

  it('applies sniffingRouteOnly to raw config inbounds', () => {
    const result = ConfigGenerator.generate(
      makeServer({
        ...baseConfig,
        rawConfig: {
          inbounds: [
            {
              protocol: 'socks',
              port: 1080,
              listen: '0.0.0.0',
              sniffing: { enabled: true, destOverride: ['http', 'tls'] },
            },
            { protocol: 'http', port: 8080, listen: '0.0.0.0' },
          ],
          outbounds: [{ tag: 'proxy', protocol: 'vless', settings: {} }],
        },
      }),
      '/tmp/log',
    );

    const socks = result.inbounds.find((ib: any) => ib.protocol === 'socks');
    expect(socks.sniffing.routeOnly).toBe(true);
    const http = result.inbounds.find((ib: any) => ib.protocol === 'http');
    expect(http.sniffing.routeOnly).toBe(true);
  });

  it('adds ad-block rule to raw configs when blockAds is true', () => {
    const result = ConfigGenerator.generate(
      makeServer({
        ...baseConfig,
        rawConfig: {
          inbounds: [],
          outbounds: [{ tag: 'proxy', protocol: 'vless', settings: {} }],
          routing: {
            rules: [
              { type: 'field', domain: ['example.com'], outboundTag: 'direct' },
            ],
          },
        },
      }),
      '/tmp/log',
      'proxy',
      {
        performanceSettings: {
          ...DEFAULT_PERFORMANCE_SETTINGS,
          blockAds: true,
        },
      },
    );

    expect(result.routing.rules[1]).toMatchObject({
      type: 'field',
      domain: ['geosite:category-ads-all'],
      outboundTag: 'block',
    });
  });

  it('prepends geoip:private direct bypass to raw routing when missing', () => {
    const result = ConfigGenerator.generate(
      makeServer({
        ...baseConfig,
        rawConfig: {
          inbounds: [],
          outbounds: [{ tag: 'proxy', protocol: 'vless', settings: {} }],
          routing: {
            rules: [
              { type: 'field', domain: ['regexp:.*'], outboundTag: 'proxy' },
            ],
          },
        },
      }),
      '/tmp/log',
      'proxy',
      {
        performanceSettings: {
          ...DEFAULT_PERFORMANCE_SETTINGS,
          blockAds: false,
          blockBittorrent: false,
        },
      },
    );

    expect(result.routing.rules[1]).toMatchObject({
      type: 'field',
      ip: ['geoip:private'],
      outboundTag: 'direct',
    });
  });

  it('keeps the API routing rule before broad raw direct rules', () => {
    const result = ConfigGenerator.generate(
      makeServer({
        ...baseConfig,
        rawConfig: {
          inbounds: [],
          outbounds: [{ tag: 'proxy', protocol: 'vless', settings: {} }],
          routing: {
            rules: [
              {
                type: 'field',
                ip: ['geoip:private'],
                outboundTag: 'direct',
              },
              { type: 'field', port: '0-65535', outboundTag: 'proxy' },
            ],
          },
        },
      }),
      '/tmp/log',
      'proxy',
      {
        performanceSettings: {
          ...DEFAULT_PERFORMANCE_SETTINGS,
          blockAds: false,
          blockBittorrent: false,
        },
      },
    );

    expect(result.routing.rules[0]).toMatchObject({
      type: 'field',
      inboundTag: ['api'],
      outboundTag: 'api',
    });
    expect(result.routing.rules[1]).toMatchObject({
      type: 'field',
      ip: ['geoip:private'],
      outboundTag: 'direct',
    });
  });

  it('does not duplicate geoip:private when raw routing already has it', () => {
    const result = ConfigGenerator.generate(
      makeServer({
        ...baseConfig,
        rawConfig: {
          inbounds: [],
          outbounds: [{ tag: 'proxy', protocol: 'vless', settings: {} }],
          routing: {
            rules: [
              {
                type: 'field',
                ip: ['geoip:private'],
                outboundTag: 'direct',
              },
              { type: 'field', port: '0-65535', outboundTag: 'proxy' },
            ],
          },
        },
      }),
      '/tmp/log',
      'proxy',
      {
        performanceSettings: {
          ...DEFAULT_PERFORMANCE_SETTINGS,
          blockAds: false,
          blockBittorrent: false,
        },
      },
    );

    expect(
      result.routing.rules.filter(
        (r: { ip?: string[]; outboundTag?: string }) =>
          r.outboundTag === 'direct' &&
          Array.isArray(r.ip) &&
          r.ip.includes('geoip:private'),
      ),
    ).toHaveLength(1);
  });

  it('normalizes raw local proxy inbounds to the app ports', () => {
    const result = ConfigGenerator.generate(
      makeServer({
        ...baseConfig,
        rawConfig: {
          inbounds: [
            {
              protocol: 'socks',
              port: 9999,
              listen: '0.0.0.0',
              settings: { auth: 'password' },
            },
            {
              protocol: 'http',
              port: 9998,
              listen: '0.0.0.0',
            },
          ],
          outbounds: [{ tag: 'proxy', protocol: 'vless', settings: {} }],
        },
      }),
      '/tmp/log',
    );

    expect(
      result.inbounds.filter((inbound: any) => inbound.protocol === 'socks'),
    ).toEqual([
      expect.objectContaining({
        port: 10808,
        listen: '127.0.0.1',
        settings: expect.objectContaining({ udp: true }),
      }),
    ]);
    expect(
      result.inbounds.filter((inbound: any) => inbound.protocol === 'http'),
    ).toEqual([
      expect.objectContaining({
        port: 10809,
        listen: '127.0.0.1',
      }),
    ]);
  });
});
