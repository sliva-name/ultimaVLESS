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

    const tunInbound = config.inbounds?.find(
      (inbound) => inbound.protocol === 'tun',
    );
    expect(tunInbound).toMatchObject({
      protocol: 'tun',
      settings: expect.objectContaining({
        mtu: 1500,
        gateway: expect.any(Array),
        dns: expect.any(Array),
        autoSystemRoutingTable: ['0.0.0.0/0', '::/0'],
        autoOutboundsInterface: 'auto',
      }),
    });
    expect(config.outbounds[0].sendThrough).toBe('192.168.1.10');
  });
});
