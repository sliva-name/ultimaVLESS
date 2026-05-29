import { describe, expect, it } from 'vitest';
import { makeServer } from '@/test/factories';
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
    });
  });

  it('adds TUN runtime options when compiling in TUN mode', () => {
    const config = XrayConfigCompiler.compile(makeServer(), {
      logPath: '/tmp/xray.log',
      connectionMode: 'tun',
      sendThrough: '192.168.1.10',
      tunAutoRoute: true,
    });

    expect(config.inbounds.some((inbound) => inbound.protocol === 'tun')).toBe(
      true,
    );
    expect(config.outbounds[0].sendThrough).toBe('192.168.1.10');
  });
});
