import { describe, expect, it } from 'vitest';
import { DEFAULT_PERFORMANCE_SETTINGS } from '@/shared/types';
import type { XrayConfig, XrayRoutingRule } from '@/shared/xray-types';
import {
  applyRemoteDnsSettings,
  buildDnsObject,
  DNS_MODULE_TAG,
  DNS_OUTBOUND_TAG,
  ensureDnsHijackRule,
  ensureDnsOutbound,
} from '@/main/services/configGenerator/dns';

describe('configGenerator/dns', () => {
  it('buildDnsObject uses remote servers without localhost', () => {
    expect(buildDnsObject(DEFAULT_PERFORMANCE_SETTINGS)).toEqual({
      servers: ['1.1.1.1', '1.0.0.1'],
      queryStrategy: 'UseIPv4',
      tag: DNS_MODULE_TAG,
      disableFallback: true,
    });
  });

  it('buildDnsObject adapts queryStrategy to the connection mode', () => {
    // Proxy mode carries no IPv6, so AAAA answers would resolve to addresses
    // that can only leave the machine outside the tunnel.
    expect(
      buildDnsObject(DEFAULT_PERFORMANCE_SETTINGS, { tunMode: false }),
    ).toMatchObject({ queryStrategy: 'UseIPv4' });
    // TUN routes ::/0, so let Xray follow the host's actual gateways.
    expect(
      buildDnsObject(DEFAULT_PERFORMANCE_SETTINGS, { tunMode: true }),
    ).toMatchObject({ queryStrategy: 'UseSystem' });
  });

  it('dns-out hijacks every query type so qType 65 cannot leak', () => {
    const cfg: XrayConfig = {
      outbounds: [{ tag: 'proxy', protocol: 'vless', settings: {} }],
    };
    ensureDnsOutbound(cfg, '1.1.1.1');
    const settings = cfg.outbounds?.[1]?.settings as {
      rules: Array<Record<string, unknown>>;
    };
    expect(settings.rules).toEqual([{ action: 'hijack' }]);
    expect(settings.rules.some((rule) => rule.action === 'direct')).toBe(false);
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
    const proxyCfg: XrayConfig = {
      outbounds: [],
      routing: { domainStrategy: 'AsIs', rules: [] },
    };
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
    // The DNS module pin must precede the hijack, otherwise the module's own
    // upstream query matches `port: 53` and is fed back into itself.
    expect(tunCfg.routing?.rules?.[0]).toMatchObject({
      inboundTag: [DNS_MODULE_TAG],
      outboundTag: 'proxy',
    });
    expect(tunCfg.routing?.rules?.[1]).toMatchObject({
      port: '53',
      outboundTag: 'dns-out',
    });
  });

  it('discards a subscription-supplied dns object instead of merging it', () => {
    const cfg: XrayConfig = {
      dns: {
        hosts: { 'accounts.google.com': '10.6.6.6' },
        servers: ['192.168.1.1'],
      },
      outbounds: [{ tag: 'proxy', protocol: 'vless', settings: {} }],
      routing: { domainStrategy: 'AsIs', rules: [] },
    };
    applyRemoteDnsSettings(cfg, DEFAULT_PERFORMANCE_SETTINGS, {
      tunMode: false,
    });
    expect(cfg.dns).not.toHaveProperty('hosts');
    expect(cfg.dns).toMatchObject({ servers: ['1.1.1.1', '1.0.0.1'] });
  });

  it('pins DNS module traffic to the proxy outbound', () => {
    const cfg: XrayConfig = {
      outbounds: [{ tag: 'proxy', protocol: 'vless', settings: {} }],
      routing: { domainStrategy: 'AsIs', rules: [] },
    };
    applyRemoteDnsSettings(cfg, DEFAULT_PERFORMANCE_SETTINGS, {
      tunMode: false,
    });
    expect(cfg.routing?.rules?.[0]).toMatchObject({
      inboundTag: [DNS_MODULE_TAG],
      outboundTag: 'proxy',
    });
  });

  it('skips the DNS module pin when no proxy outbound exists', () => {
    const cfg: XrayConfig = {
      outbounds: [{ tag: 'direct', protocol: 'freedom', settings: {} }],
      routing: { domainStrategy: 'AsIs', rules: [] },
    };
    applyRemoteDnsSettings(cfg, DEFAULT_PERFORMANCE_SETTINGS, {
      tunMode: false,
    });
    expect(cfg.routing?.rules).toEqual([]);
  });
});
