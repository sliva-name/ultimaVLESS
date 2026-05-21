import { describe, expect, it } from 'vitest';
import { DEFAULT_PERFORMANCE_SETTINGS } from '@/shared/types';
import type { XrayConfig } from '@/shared/xray-types';
import {
  createLocalProxyInbounds,
  createTunInbound,
  ensureLocalProxyInbounds,
  MutableInbound,
} from './inbounds';
import { buildDefaultRoutingRules } from './routing';
import { applyStatsApi } from './statsApi';

describe('configGenerator builders', () => {
  it('creates and normalizes local proxy inbounds', () => {
    const defaults = createLocalProxyInbounds(true);
    expect(defaults.map((inbound) => inbound.tag)).toEqual(['socks', 'http']);

    const inbounds: MutableInbound[] = [{ protocol: 'socks' }];
    ensureLocalProxyInbounds(inbounds, false);

    expect(inbounds).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tag: 'socks',
          port: 10808,
          listen: '127.0.0.1',
          settings: expect.objectContaining({ udp: true }),
          sniffing: expect.objectContaining({ routeOnly: false }),
        }),
        expect.objectContaining({
          tag: 'http',
          port: 10809,
          listen: '127.0.0.1',
        }),
      ]),
    );
  });

  it('creates TUN inbound with optional auto-route settings', () => {
    const tunInbound = createTunInbound({ tunAutoRoute: true });

    expect(tunInbound).toMatchObject({
      tag: 'tun-in',
      protocol: 'tun',
      settings: {
        name: 'ultima0',
        autoOutboundsInterface: 'auto',
      },
    });
    expect(tunInbound.settings).toHaveProperty('autoSystemRoutingTable', [
      '0.0.0.0/0',
      '::/0',
    ]);
  });

  it('builds routing rules and keeps stats API rule first', () => {
    const routingRules = buildDefaultRoutingRules({
      ...DEFAULT_PERFORMANCE_SETTINGS,
      blockAds: true,
      blockBittorrent: true,
    });
    expect(routingRules[0]).toMatchObject({
      domain: ['geosite:category-ads-all'],
      outboundTag: 'block',
    });
    expect(routingRules[1]).toMatchObject({
      protocol: ['bittorrent'],
      outboundTag: 'block',
    });

    const cfg: XrayConfig = {
      log: { loglevel: 'warning' },
      inbounds: [],
      outbounds: [],
      routing: {
        domainStrategy: 'AsIs',
        rules: [
          { type: 'field', ip: ['geoip:private'], outboundTag: 'direct' },
        ],
      },
    };
    applyStatsApi(cfg);

    expect(cfg.routing.rules[0]).toMatchObject({
      inboundTag: ['api'],
      outboundTag: 'api',
    });
    expect(cfg.inbounds).toEqual(
      expect.arrayContaining([expect.objectContaining({ tag: 'api' })]),
    );
    expect(cfg.outbounds).toEqual(
      expect.arrayContaining([expect.objectContaining({ tag: 'api' })]),
    );
  });
});
