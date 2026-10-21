import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PERFORMANCE_SETTINGS,
  type PerformanceSettings,
} from '@/shared/types';
import {
  buildDefaultRoutingRules,
  buildProbePinRules,
  buildSiteRules,
  resolveRoutingMode,
} from '@/main/services/configGenerator/routing';

function perf(overrides: Partial<PerformanceSettings>): PerformanceSettings {
  return { ...DEFAULT_PERFORMANCE_SETTINGS, ...overrides };
}

describe('buildSiteRules', () => {
  it('emits nothing when no exclusions are configured', () => {
    expect(buildSiteRules(perf({ bypassDomains: [], bypassIps: [] }))).toEqual(
      [],
    );
  });

  it('ships vk.com as a default exclusion', () => {
    expect(buildSiteRules(DEFAULT_PERFORMANCE_SETTINGS)).toEqual([
      {
        type: 'field',
        domain: ['domain:vk.com'],
        outboundTag: 'direct',
      },
    ]);
  });

  it('maps bare hosts to domain matchers and keeps address entries verbatim', () => {
    expect(
      buildSiteRules(
        perf({
          bypassDomains: ['example.com', 'full:a.example.com'],
          bypassIps: ['10.0.0.0/8', 'geoip:private'],
        }),
      ),
    ).toEqual([
      {
        type: 'field',
        domain: ['domain:example.com', 'full:a.example.com'],
        outboundTag: 'direct',
      },
      {
        type: 'field',
        ip: ['10.0.0.0/8', 'geoip:private'],
        outboundTag: 'direct',
      },
    ]);
  });

  it('ignores sites through the VPN outside of sites mode', () => {
    for (const routingMode of ['all', 'apps'] as const) {
      expect(
        buildSiteRules(
          perf({
            routingMode,
            bypassDomains: [],
            proxyDomains: ['youtube.com'],
            proxyIps: ['8.8.8.8'],
          }),
        ),
      ).toEqual([]);
    }
  });

  it('tunnels the selected sites and addresses in sites mode', () => {
    expect(
      buildSiteRules(
        perf({
          routingMode: 'sites',
          bypassDomains: [],
          proxyDomains: ['youtube.com', 'discord.com'],
          proxyIps: ['geoip:telegram'],
        }),
      ),
    ).toEqual([
      {
        type: 'field',
        domain: ['domain:youtube.com', 'domain:discord.com'],
        outboundTag: 'proxy',
      },
      { type: 'field', ip: ['geoip:telegram'], outboundTag: 'proxy' },
    ]);
  });

  it('lets the more specific entry win across exclusions and tunnelled sites', () => {
    const rules = buildSiteRules(
      perf({
        routingMode: 'sites',
        bypassDomains: ['maps.google.com', 'yandex.ru'],
        proxyDomains: ['google.com', 'music.yandex.ru', 'geosite:youtube'],
      }),
    );
    expect(rules).toEqual([
      {
        type: 'field',
        domain: ['domain:maps.google.com'],
        outboundTag: 'direct',
      },
      {
        type: 'field',
        domain: ['domain:music.yandex.ru'],
        outboundTag: 'proxy',
      },
      { type: 'field', domain: ['domain:yandex.ru'], outboundTag: 'direct' },
      {
        type: 'field',
        domain: ['domain:google.com', 'geosite:youtube'],
        outboundTag: 'proxy',
      },
    ]);
  });

  it('sends a site listed in both lists direct', () => {
    const rules = buildSiteRules(
      perf({
        routingMode: 'sites',
        bypassDomains: ['example.com'],
        proxyDomains: ['example.com'],
        bypassIps: ['10.1.0.0/16'],
        proxyIps: ['10.1.0.0/16', '10.0.0.0/8'],
      }),
    );
    expect(rules.map((rule) => rule.outboundTag)).toEqual([
      'direct',
      'proxy',
      'direct',
      'proxy',
    ]);
    expect(rules[2]).toEqual({
      type: 'field',
      ip: ['10.1.0.0/16'],
      outboundTag: 'direct',
    });
    expect(rules[3].ip).toEqual(['10.1.0.0/16', '10.0.0.0/8']);
  });

  it('ranks full: above domain: on the same host', () => {
    const rules = buildSiteRules(
      perf({
        routingMode: 'sites',
        bypassDomains: ['example.com'],
        proxyDomains: ['full:example.com'],
      }),
    );
    expect(rules.map((rule) => rule.outboundTag)).toEqual(['proxy', 'direct']);
  });
});

describe('resolveRoutingMode', () => {
  it('falls back to tunnelling everything for missing or unknown values', () => {
    expect(resolveRoutingMode({ routingMode: 'sites' })).toBe('sites');
    expect(
      resolveRoutingMode({} as Pick<PerformanceSettings, 'routingMode'>),
    ).toBe('all');
    expect(
      resolveRoutingMode({
        routingMode: 'bogus',
      } as unknown as Pick<PerformanceSettings, 'routingMode'>),
    ).toBe('all');
  });
});

describe('buildDefaultRoutingRules', () => {
  it('places exclusions after block rules and before the catch-all proxy rule', () => {
    const rules = buildDefaultRoutingRules(
      perf({ blockAds: true, bypassDomains: ['example.com'] }),
    );

    const outboundTags = rules.map((rule) => rule.outboundTag);
    expect(outboundTags).toEqual(['block', 'direct', 'direct', 'proxy']);
    expect(rules[1]).toEqual({
      type: 'field',
      domain: ['domain:example.com'],
      outboundTag: 'direct',
    });
    expect(rules[rules.length - 1]).toEqual({
      type: 'field',
      port: '0-65535',
      outboundTag: 'proxy',
    });
  });

  it('keeps the default config unchanged by the routing modes', () => {
    expect(buildDefaultRoutingRules(DEFAULT_PERFORMANCE_SETTINGS)).toEqual([
      { type: 'field', domain: ['domain:vk.com'], outboundTag: 'direct' },
      { type: 'field', ip: ['geoip:private'], outboundTag: 'direct' },
      { type: 'field', port: '0-65535', outboundTag: 'proxy' },
    ]);
  });

  it('sends direct apps out first, behind the block rules, in every mode', () => {
    for (const routingMode of ['all', 'sites', 'apps'] as const) {
      const rules = buildDefaultRoutingRules(
        perf({
          routingMode,
          blockBittorrent: true,
          directApps: ['qbittorrent.exe', 'Steam.exe'],
        }),
      );
      const blockIndex = rules.findIndex((r) => r.outboundTag === 'block');
      const appIndex = rules.findIndex((r) => r.process !== undefined);
      expect(rules[appIndex]).toEqual({
        type: 'field',
        process: ['qbittorrent.exe', 'Steam.exe'],
        outboundTag: 'direct',
      });
      expect(blockIndex).toBeGreaterThanOrEqual(0);
      expect(appIndex).toBe(blockIndex + 1);
    }
  });

  it('defaults to direct and tunnels only the selected sites in sites mode', () => {
    const rules = buildDefaultRoutingRules(
      perf({
        routingMode: 'sites',
        proxyDomains: ['youtube.com'],
        proxyApps: ['chrome.exe'],
      }),
    );
    // Equally specific hosts: the exclusion is listed first.
    expect(rules.slice(2)).toEqual([
      { type: 'field', domain: ['domain:vk.com'], outboundTag: 'direct' },
      { type: 'field', domain: ['domain:youtube.com'], outboundTag: 'proxy' },
      { type: 'field', ip: ['geoip:private'], outboundTag: 'direct' },
      { type: 'field', port: '0-65535', outboundTag: 'direct' },
    ]);
    // Apps through the VPN belong to apps mode only.
    expect(rules.some((r) => r.process !== undefined)).toBe(false);
  });

  it('tunnels the selected apps behind exclusions and the LAN bypass in apps mode', () => {
    const rules = buildDefaultRoutingRules(
      perf({
        routingMode: 'apps',
        proxyApps: ['Discord.exe', 'Telegram.exe'],
        proxyDomains: ['youtube.com'],
      }),
    );
    expect(rules.slice(2)).toEqual([
      { type: 'field', domain: ['domain:vk.com'], outboundTag: 'direct' },
      { type: 'field', ip: ['geoip:private'], outboundTag: 'direct' },
      {
        type: 'field',
        process: ['Discord.exe', 'Telegram.exe'],
        outboundTag: 'proxy',
      },
      { type: 'field', port: '0-65535', outboundTag: 'direct' },
    ]);
  });

  it('lets a direct app win over the same app through the VPN', () => {
    const rules = buildDefaultRoutingRules(
      perf({
        routingMode: 'apps',
        directApps: ['chrome.exe'],
        proxyApps: ['chrome.exe'],
      }),
    );
    const processRules = rules.filter((r) => r.process !== undefined);
    expect(processRules.map((r) => r.outboundTag)).toEqual(['direct', 'proxy']);
  });

  it('pins the health probes to the tunnel in the selective modes only', () => {
    expect(buildProbePinRules(DEFAULT_PERFORMANCE_SETTINGS)).toEqual([]);
    for (const routingMode of ['sites', 'apps'] as const) {
      const rules = buildDefaultRoutingRules(perf({ routingMode }));
      expect(rules.slice(0, 2)).toEqual([
        {
          type: 'field',
          domain: [
            'full:connectivitycheck.gstatic.com',
            'full:captive.apple.com',
            'full:www.msftncsi.com',
          ],
          port: '80',
          outboundTag: 'proxy',
        },
        { type: 'field', ip: ['1.1.1.1'], port: '80', outboundTag: 'proxy' },
      ]);
    }
  });

  it('treats settings saved before routing modes existed as tunnel-everything', () => {
    const legacy = { ...DEFAULT_PERFORMANCE_SETTINGS } as Record<
      string,
      unknown
    >;
    for (const key of [
      'routingMode',
      'proxyDomains',
      'proxyIps',
      'proxyApps',
      'directApps',
    ]) {
      delete legacy[key];
    }
    expect(
      buildDefaultRoutingRules(legacy as unknown as PerformanceSettings),
    ).toEqual(buildDefaultRoutingRules(DEFAULT_PERFORMANCE_SETTINGS));
  });
});
