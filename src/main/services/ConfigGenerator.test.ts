import { describe, expect, it } from 'vitest';
import { ConfigGenerator } from './ConfigGenerator';
import { makeServer } from '../../test/factories';

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
      '/tmp/log'
    );

    expect(result.outbounds[0].streamSettings).toMatchObject({
      security: 'tls',
      tlsSettings: {
        serverName: 'example.com',
      },
    });
  });

  it('uses the default reality fingerprint when fp is missing', () => {
    const result = ConfigGenerator.generate(makeServer({ ...baseConfig, fp: undefined }), '/tmp/log');

    expect(result.outbounds[0].streamSettings?.realitySettings?.fingerprint).toBe('chrome');
  });

  it('omits empty flow on the VLESS user object', () => {
    const result = ConfigGenerator.generate(makeServer({ ...baseConfig, flow: undefined }), '/tmp/log');
    const user = (result.outbounds[0] as any).settings.vnext[0].users[0];
    expect(user.flow).toBeUndefined();
    expect(user.encryption).toBe('none');
  });

  it('adds kcpSettings for kcp transport', () => {
    const result = ConfigGenerator.generate(makeServer({ ...baseConfig, type: 'kcp', security: 'none' }), '/tmp/log');
    expect(result.outbounds[0].streamSettings?.network).toBe('kcp');
    expect(result.outbounds[0].streamSettings?.kcpSettings?.header).toEqual({ type: 'none' });
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
      '/tmp/log'
    );
    expect(result.outbounds[0].streamSettings?.httpSettings).toEqual({
      path: '/p',
      host: ['cdn.test'],
    });
  });

  it('adds quicSettings for quic transport', () => {
    const result = ConfigGenerator.generate(makeServer({ ...baseConfig, type: 'quic', security: 'tls' }), '/tmp/log');
    expect(result.outbounds[0].streamSettings?.network).toBe('quic');
    expect(result.outbounds[0].streamSettings?.quicSettings?.header).toEqual({ type: 'none' });
  });

  it('routes bittorrent traffic to the block outbound', () => {
    const result = ConfigGenerator.generate(baseConfig, '/tmp/log');

    expect(
      result.routing.rules.some((rule: any) => rule.protocol?.includes('bittorrent') && rule.outboundTag === 'block')
    ).toBe(true);
  });

  it('adds tun-specific settings when tun mode is enabled', () => {
    const result = ConfigGenerator.generate(baseConfig, '/tmp/log', 'tun', {
      sendThrough: '192.168.1.10',
      tunAutoRoute: true,
    });
    const tunInbound = getTunInbound(result);

    expect(tunInbound.settings).toMatchObject({
      mtu: 1500,
      autoRoute: true,
      strictRoute: true,
    });
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
      { tunAutoRoute: true }
    );

    const tunInbounds = result.inbounds.filter((inbound: any) => inbound.protocol === 'tun');
    expect(tunInbounds).toHaveLength(1);
    expect(tunInbounds[0].tag).toBe('existing-tun');
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
      '/tmp/log'
    );

    expect(result.inbounds.filter((inbound: any) => inbound.protocol === 'socks')).toEqual([
      expect.objectContaining({
        port: 10808,
        listen: '127.0.0.1',
        settings: expect.objectContaining({ udp: true }),
      }),
    ]);
    expect(result.inbounds.filter((inbound: any) => inbound.protocol === 'http')).toEqual([
      expect.objectContaining({
        port: 10809,
        listen: '127.0.0.1',
      }),
    ]);
  });
});

