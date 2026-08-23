import { describe, expect, it } from 'vitest';
import {
  isUnmodifiedLegacyPerformanceSettings,
  LEGACY_PERFORMANCE_CORE,
  normalizePerformanceSettings,
  performanceSettingsEqual,
} from './performanceSettings';
import { DEFAULT_PERFORMANCE_SETTINGS } from './types';

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

  it('inherits the shipped exclusions when no list was ever saved', () => {
    expect(normalizePerformanceSettings({}).bypassDomains).toEqual(['vk.com']);
    expect(normalizePerformanceSettings({}).bypassIps).toEqual([]);
  });

  it('keeps a cleared exclusion list cleared', () => {
    expect(
      normalizePerformanceSettings({ bypassDomains: [] }).bypassDomains,
    ).toEqual([]);
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
  });
});
