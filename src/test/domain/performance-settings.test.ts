import { describe, expect, it } from 'vitest';
import {
  isUnmodifiedLegacyPerformanceSettings,
  LEGACY_PERFORMANCE_CORE,
  normalizePerformanceSettings,
  performanceSettingsEqual,
} from '@/shared/performanceSettings';
import { DEFAULT_PERFORMANCE_SETTINGS, TUN_MTU_DEFAULT } from '@/shared/types';

describe('normalizePerformanceSettings', () => {
  it('accepts extended TLS fingerprints', () => {
    for (const fingerprint of ['ios', 'android', '360', 'qq'] as const) {
      expect(normalizePerformanceSettings({ fingerprint }).fingerprint).toBe(
        fingerprint,
      );
    }
  });

  it('falls back for unknown fingerprints', () => {
    expect(
      normalizePerformanceSettings({ fingerprint: 'not-a-browser' })
        .fingerprint,
    ).toBe('chrome');
  });

  it('clamps xhttpMaxConnections to 1–16 with default 3', () => {
    expect(normalizePerformanceSettings({}).xhttpMaxConnections).toBe(3);
    expect(
      normalizePerformanceSettings({ xhttpMaxConnections: 6 })
        .xhttpMaxConnections,
    ).toBe(6);
    expect(
      normalizePerformanceSettings({ xhttpMaxConnections: 0 })
        .xhttpMaxConnections,
    ).toBe(1);
    expect(
      normalizePerformanceSettings({ xhttpMaxConnections: 99 })
        .xhttpMaxConnections,
    ).toBe(16);
  });

  it('clamps TUN MTU and accepts Xray DNS query strategies', () => {
    expect(normalizePerformanceSettings({}).tunMtu).toBe(TUN_MTU_DEFAULT);
    expect(normalizePerformanceSettings({}).tunDnsQueryStrategy).toBe(
      'UseIPv4',
    );
    expect(normalizePerformanceSettings({ tunMtu: 1280 }).tunMtu).toBe(1280);
    expect(normalizePerformanceSettings({ tunMtu: 1500 }).tunMtu).toBe(1500);
    expect(normalizePerformanceSettings({ tunMtu: 9000 }).tunMtu).toBe(1500);
    expect(normalizePerformanceSettings({ tunMtu: 500 }).tunMtu).toBe(1280);
    expect(
      normalizePerformanceSettings({ tunDnsQueryStrategy: 'UseSystem' })
        .tunDnsQueryStrategy,
    ).toBe('UseSystem');
    expect(
      normalizePerformanceSettings({ tunDnsQueryStrategy: 'UseIP' })
        .tunDnsQueryStrategy,
    ).toBe('UseIP');
    expect(
      normalizePerformanceSettings({ tunDnsQueryStrategy: 'not-a-strategy' })
        .tunDnsQueryStrategy,
    ).toBe('UseIPv4');
  });

  it('keeps the TUN DNS leak block off unless saved as true', () => {
    // Off by default, as Xray's autoSystemWfpBlockLeak is.
    expect(normalizePerformanceSettings({}).tunBlockDnsLeaks).toBe(false);
    expect(
      normalizePerformanceSettings({ tunBlockDnsLeaks: true }).tunBlockDnsLeaks,
    ).toBe(true);
    expect(
      normalizePerformanceSettings({ tunBlockDnsLeaks: false })
        .tunBlockDnsLeaks,
    ).toBe(false);
    for (const junk of ['true', 1, null, ['dns']]) {
      expect(
        normalizePerformanceSettings({ tunBlockDnsLeaks: junk })
          .tunBlockDnsLeaks,
      ).toBe(false);
    }
  });

  it('resolves remote DNS presets and validates custom IPv4', () => {
    expect(normalizePerformanceSettings({}).remoteDnsServers).toEqual([
      '1.1.1.1',
      '1.0.0.1',
    ]);
    expect(
      normalizePerformanceSettings({ remoteDnsPreset: 'google' })
        .remoteDnsServers,
    ).toEqual(['8.8.8.8', '8.8.4.4']);
    expect(
      normalizePerformanceSettings({
        remoteDnsPreset: 'custom',
        remoteDnsServers: ['9.9.9.9', 'not-an-ip', '1.1.1.1', '8.8.8.8'],
      }).remoteDnsServers,
    ).toEqual(['9.9.9.9', '1.1.1.1']);
    expect(
      normalizePerformanceSettings({
        remoteDnsPreset: 'custom',
        remoteDnsServers: ['bogus'],
      }).remoteDnsServers,
    ).toEqual(['1.1.1.1', '1.0.0.1']);
  });

  it('keeps only usable split tunneling entries', () => {
    const settings = normalizePerformanceSettings({
      bypassDomains: [
        'https://Example.COM/path?q=1',
        '*.example.com',
        'geosite:category-ru',
        'regexp:.*',
        '10.0.0.1',
      ],
      bypassIps: ['10.0.0.0/8', 'not-an-ip', '10.0.0.0/8', 'geoip:private'],
    });

    expect(settings.bypassDomains).toEqual([
      'example.com',
      'geosite:category-ru',
    ]);
    expect(settings.bypassIps).toEqual(['10.0.0.0/8', 'geoip:private']);
  });

  it('keeps a TUN adapter alias and falls back to automatic for junk', () => {
    expect(normalizePerformanceSettings({}).tunOutboundInterface).toBe('');
    for (const name of ['Ethernet 2', 'Беспроводная сеть', "Wi-Fi 'home' $x"]) {
      expect(
        normalizePerformanceSettings({ tunOutboundInterface: name })
          .tunOutboundInterface,
      ).toBe(name);
    }
    for (const junk of [42, null, '   ', 'Wi\nFi', 'x'.repeat(257)]) {
      expect(
        normalizePerformanceSettings({ tunOutboundInterface: junk })
          .tunOutboundInterface,
      ).toBe('');
    }
  });

  it('inherits the shipped exclusions when no list was ever saved', () => {
    expect(normalizePerformanceSettings({}).bypassDomains).toEqual(['vk.com']);
    expect(normalizePerformanceSettings({}).bypassIps).toEqual([]);
  });

  it('keeps a cleared exclusion list cleared', () => {
    expect(
      normalizePerformanceSettings({ bypassDomains: [] }).bypassDomains,
    ).toEqual([]);
  });

  it('defaults routing to the whole tunnel with empty lists', () => {
    const settings = normalizePerformanceSettings({ bypassDomains: [] });
    expect(settings).toMatchObject({
      routingMode: 'all',
      proxyDomains: [],
      proxyIps: [],
      proxyApps: [],
      directApps: [],
    });
  });

  it('keeps the routing mode and usable routing entries', () => {
    const settings = normalizePerformanceSettings({
      routingMode: 'apps',
      proxyDomains: ['https://www.YouTube.com/watch', 'regexp:.*', '1.2.3.4'],
      proxyIps: ['geoip:telegram', 'youtube.com', '91.108.4.0/22'],
      proxyApps: ['C:\\Apps\\Telegram.exe', 'Telegram.exe', 'self/'],
      directApps: ['steam.EXE', '', 42],
    });
    expect(settings.routingMode).toBe('apps');
    expect(settings.proxyDomains).toEqual(['www.youtube.com']);
    expect(settings.proxyIps).toEqual(['geoip:telegram', '91.108.4.0/22']);
    expect(settings.proxyApps).toEqual(['Telegram.exe']);
    expect(settings.directApps).toEqual(['steam.exe']);
    expect(
      normalizePerformanceSettings({ routingMode: 'everything' }).routingMode,
    ).toBe('all');
  });
});

describe('legacy performance migration guard', () => {
  const legacyCore = { ...LEGACY_PERFORMANCE_CORE };

  it('matches the unmodified pre-lean defaults', () => {
    expect(isUnmodifiedLegacyPerformanceSettings(legacyCore)).toBe(true);
  });

  it('does not migrate when split-tunnel lists were saved, even if empty', () => {
    expect(
      isUnmodifiedLegacyPerformanceSettings({
        ...legacyCore,
        bypassDomains: [],
      }),
    ).toBe(false);
    expect(
      isUnmodifiedLegacyPerformanceSettings({
        ...legacyCore,
        bypassDomains: ['example.com'],
      }),
    ).toBe(false);
  });

  it('does not migrate when routing rules were saved', () => {
    for (const saved of [
      { routingMode: 'all' },
      { proxyDomains: [] },
      { proxyApps: ['chrome.exe'] },
      { directApps: [] },
    ]) {
      expect(
        isUnmodifiedLegacyPerformanceSettings({ ...legacyCore, ...saved }),
      ).toBe(false);
    }
  });

  it('does not migrate customized DNS or TUN routing', () => {
    expect(
      isUnmodifiedLegacyPerformanceSettings({
        ...legacyCore,
        remoteDnsPreset: 'google',
      }),
    ).toBe(false);
    expect(
      isUnmodifiedLegacyPerformanceSettings({
        ...legacyCore,
        remoteDnsServers: ['8.8.8.8', '8.8.4.4'],
      }),
    ).toBe(false);
    expect(
      isUnmodifiedLegacyPerformanceSettings({
        ...legacyCore,
        windowsTunRouting: 'xray',
      }),
    ).toBe(false);
    expect(
      isUnmodifiedLegacyPerformanceSettings({
        ...legacyCore,
        tunMtu: 1280,
      }),
    ).toBe(false);
    expect(
      isUnmodifiedLegacyPerformanceSettings({
        ...legacyCore,
        tunDnsQueryStrategy: 'UseSystem',
      }),
    ).toBe(false);
    expect(
      isUnmodifiedLegacyPerformanceSettings({
        ...legacyCore,
        tunOutboundInterface: 'Ethernet 2',
      }),
    ).toBe(false);
    expect(
      isUnmodifiedLegacyPerformanceSettings({
        ...legacyCore,
        tunBlockDnsLeaks: true,
      }),
    ).toBe(false);
  });

  it('compares every performance field, including lists', () => {
    expect(
      performanceSettingsEqual(
        DEFAULT_PERFORMANCE_SETTINGS,
        DEFAULT_PERFORMANCE_SETTINGS,
      ),
    ).toBe(true);
    expect(
      performanceSettingsEqual(DEFAULT_PERFORMANCE_SETTINGS, {
        ...DEFAULT_PERFORMANCE_SETTINGS,
        bypassDomains: ['example.com'],
      }),
    ).toBe(false);
    expect(
      performanceSettingsEqual(DEFAULT_PERFORMANCE_SETTINGS, {
        ...DEFAULT_PERFORMANCE_SETTINGS,
        tunOutboundInterface: 'Ethernet 2',
      }),
    ).toBe(false);
    for (const change of [
      { tunBlockDnsLeaks: true },
      { routingMode: 'sites' as const },
      { proxyDomains: ['youtube.com'] },
      { proxyIps: ['8.8.8.8'] },
      { proxyApps: ['chrome.exe'] },
      { directApps: ['steam.exe'] },
    ]) {
      expect(
        performanceSettingsEqual(DEFAULT_PERFORMANCE_SETTINGS, {
          ...DEFAULT_PERFORMANCE_SETTINGS,
          ...change,
        }),
      ).toBe(false);
    }
  });
});
