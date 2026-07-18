import { describe, expect, it } from 'vitest';
import { makeServer } from '@/test/factories';
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
    });
  });

  it('adds TUN runtime options when compiling in TUN mode', () => {
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
        dns: expect.any(Array),
        autoSystemRoutingTable: ['0.0.0.0/0', '::/0'],
        autoOutboundsInterface: 'auto',
      }),
    });
    expect(config.outbounds[0].sendThrough).toBe('192.168.1.10');
  });

  it('rejects unencrypted public VLESS profiles before spawning Xray', () => {
    expect(() =>
      XrayConfigCompiler.compile(makeServer({ security: 'none' }), {
        logPath: '/tmp/xray.log',
        connectionMode: 'proxy',
      }),
    ).toThrow(/TLS\/REALITY/);
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
      method: 'tcp',
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
});
