import { describe, expect, it } from 'vitest';
import { DEFAULT_PERFORMANCE_SETTINGS } from '@/shared/types';
import type { XrayConfig, XrayRoutingRule } from '@/shared/xray-types';
import {
  applyRemoteDnsSettings,
  buildDnsObject,
  DNS_OUTBOUND_TAG,
  ensureDnsHijackRule,
  ensureDnsOutbound,
} from './dns';

describe('configGenerator/dns', () => {
  it('buildDnsObject uses remote servers without localhost', () => {
    expect(buildDnsObject(DEFAULT_PERFORMANCE_SETTINGS)).toEqual({
      servers: ['1.1.1.1', '1.0.0.1'],
      queryStrategy: 'UseIPv4',
    });
  });

  it('ensureDnsOutbound inserts dns-out before direct', () => {
    const cfg: XrayConfig = {
      outbounds: [
        { tag: 'proxy', protocol: 'vless', settings: {} },
        { tag: 'direct', protocol: 'freedom', settings: {} },
        { tag: 'block', protocol: 'blackhole', settings: {} },
      ],
    };
    ensureDnsOutbound(cfg, '9.9.9.9');
    expect(cfg.outbounds?.map((o) => o.tag)).toEqual([
      'proxy',
      'dns-out',
      'direct',
      'block',
    ]);
    expect(cfg.outbounds?.[1]).toMatchObject({
      tag: DNS_OUTBOUND_TAG,
      protocol: 'dns',
      settings: {
        rewriteAddress: '9.9.9.9',
        rewritePort: 53,
        rewriteNetwork: 'udp',
      },
    });
  });

  it('ensureDnsHijackRule places port 53 after api rule', () => {
    const rules: XrayRoutingRule[] = [
      { type: 'field', inboundTag: ['api'], outboundTag: 'api' },
      { type: 'field', ip: ['geoip:private'], outboundTag: 'direct' },
      { type: 'field', port: '0-65535', outboundTag: 'proxy' },
    ];
    ensureDnsHijackRule(rules);
    expect(rules[0].inboundTag).toEqual(['api']);
    expect(rules[1]).toMatchObject({
      port: '53',
      network: 'udp,tcp',
      outboundTag: 'dns-out',
    });
  });

  it('applyRemoteDnsSettings only adds hijack in TUN mode', () => {
    const proxyCfg: XrayConfig = { outbounds: [], routing: { domainStrategy: 'AsIs', rules: [] } };
    applyRemoteDnsSettings(proxyCfg, DEFAULT_PERFORMANCE_SETTINGS, {
      tunMode: false,
    });
    expect(proxyCfg.dns).toMatchObject({ servers: ['1.1.1.1', '1.0.0.1'] });
    expect(proxyCfg.outbounds?.some((o) => o.tag === 'dns-out')).toBeFalsy();

    const tunCfg: XrayConfig = {
      outbounds: [
        { tag: 'proxy', protocol: 'vless', settings: {} },
        { tag: 'direct', protocol: 'freedom', settings: {} },
      ],
      routing: { domainStrategy: 'AsIs', rules: [] },
      inbounds: [
        {
          tag: 'tun-in',
          port: 0,
          protocol: 'tun',
          settings: { dns: ['8.8.8.8'] },
        },
      ],
    };
    applyRemoteDnsSettings(tunCfg, DEFAULT_PERFORMANCE_SETTINGS, {
      tunMode: true,
    });
    expect(tunCfg.inbounds?.[0].settings).toMatchObject({
      dns: ['1.1.1.1', '1.0.0.1'],
    });
    expect(tunCfg.outbounds?.some((o) => o.tag === 'dns-out')).toBe(true);
    expect(tunCfg.routing?.rules?.[0]).toMatchObject({
      port: '53',
      outboundTag: 'dns-out',
    });
  });
});
