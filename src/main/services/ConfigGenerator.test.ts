import { describe, it, expect } from 'vitest';
import { ConfigGenerator } from './ConfigGenerator';
import { VlessConfig } from '../../shared/types';

describe('ConfigGenerator', () => {
  const mockConfig: VlessConfig = {
    uuid: '123-uuid',
    address: 'example.com',
    port: 443,
    name: 'Test Server',
    type: 'tcp',
    security: 'reality',
    flow: 'xtls-rprx-vision',
    sni: 'example.com',
    fp: 'chrome',
    pbk: 'public-key',
    sid: 'short-id',
  };

  it('should generate valid Xray config for VLESS Reality', () => {
    const logPath = '/tmp/xray.log';
    const result = ConfigGenerator.generate(mockConfig, logPath);

    expect(result.log.access).toBe(logPath);
    expect(result.outbounds?.[0].protocol).toBe('vless');
    expect(result.outbounds?.[0].streamSettings?.security).toBe('reality');
    expect(result.outbounds?.[0].streamSettings?.realitySettings?.publicKey).toBe('public-key');
    expect(result.outbounds?.[0].streamSettings?.realitySettings?.shortId).toBe('short-id');
  });

  it('should handle TLS security', () => {
    const tlsConfig: VlessConfig = {
        ...mockConfig,
        security: 'tls',
        sid: undefined,
        pbk: undefined,
        fp: undefined
    };
    
    const result = ConfigGenerator.generate(tlsConfig, '/tmp/log');
    expect(result.outbounds?.[0].streamSettings?.security).toBe('tls');
    expect(result.outbounds?.[0].streamSettings?.tlsSettings?.serverName).toBe('example.com');
  });

  it('should set default fingerprint if missing', () => {
    const noFpConfig = { ...mockConfig, fp: undefined };
    const result = ConfigGenerator.generate(noFpConfig, '/tmp/log');
    expect(result.outbounds?.[0].streamSettings?.realitySettings?.fingerprint).toBe('chrome');
  });

  it('should route bittorrent traffic to block outbound', () => {
    const result = ConfigGenerator.generate(mockConfig, '/tmp/log');
    expect(result.routing?.rules?.some((rule: any) => rule.protocol?.includes('bittorrent') && rule.outboundTag === 'block')).toBe(true);
  });

  it('should generate tun inbound with lowercase mtu key', () => {
    const result = ConfigGenerator.generate(mockConfig, '/tmp/log', 'tun');
    const tunInbound = result.inbounds?.find((inbound: any) => inbound.tag === 'tun-in');
    expect(tunInbound).toBeTruthy();
    expect(tunInbound.settings?.mtu).toBe(1400);
    expect((tunInbound.settings as any).MTU).toBeUndefined();
  });

  it('should set sendThrough in tun mode when provided', () => {
    const result = ConfigGenerator.generate(mockConfig, '/tmp/log', 'tun', {
      sendThrough: '192.168.1.10',
    });
    expect(result.outbounds?.[0]?.sendThrough).toBe('192.168.1.10');
  });

  it('should enable autoRoute in tun mode when requested', () => {
    const result = ConfigGenerator.generate(mockConfig, '/tmp/log', 'tun', {
      tunAutoRoute: true,
    });
    const tunInbound = result.inbounds?.find((inbound: any) => inbound.tag === 'tun-in');
    expect(tunInbound.settings?.autoRoute).toBe(true);
    expect(tunInbound.settings?.strictRoute).toBe(true);
  });

  it('should not add duplicate tun inbound for raw configs that already define one', () => {
    const result = ConfigGenerator.generate(
      {
        ...mockConfig,
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
      },
      '/tmp/log',
      'tun',
      { tunAutoRoute: true }
    );

    const tunInbounds = result.inbounds?.filter((inbound: any) => inbound.protocol === 'tun') ?? [];
    expect(tunInbounds).toHaveLength(1);
    expect(tunInbounds[0].tag).toBe('existing-tun');
  });
});

