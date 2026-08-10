import { describe, expect, it } from 'vitest';
import {
  isValidIpv4Address,
  normalizePerformanceSettings,
} from './performanceSettings';

describe('normalizePerformanceSettings', () => {
  it('accepts extended TLS fingerprints', () => {
    for (const fingerprint of ['ios', 'android', '360', 'qq'] as const) {
      expect(
        normalizePerformanceSettings({ fingerprint }).fingerprint,
      ).toBe(fingerprint);
    }
  });

  it('falls back for unknown fingerprints', () => {
    expect(
      normalizePerformanceSettings({ fingerprint: 'not-a-browser' }).fingerprint,
    ).toBe('chrome');
  });

  it('clamps xhttpMaxConnections to 1–16 with default 3', () => {
    expect(normalizePerformanceSettings({}).xhttpMaxConnections).toBe(3);
    expect(
      normalizePerformanceSettings({ xhttpMaxConnections: 6 }).xhttpMaxConnections,
    ).toBe(6);
    expect(
      normalizePerformanceSettings({ xhttpMaxConnections: 0 }).xhttpMaxConnections,
    ).toBe(1);
    expect(
      normalizePerformanceSettings({ xhttpMaxConnections: 99 }).xhttpMaxConnections,
    ).toBe(16);
  });

  it('resolves remote DNS presets and validates custom IPv4', () => {
    expect(normalizePerformanceSettings({}).remoteDnsServers).toEqual([
      '1.1.1.1',
      '1.0.0.1',
    ]);
    expect(
      normalizePerformanceSettings({ remoteDnsPreset: 'google' }).remoteDnsServers,
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
});

describe('isValidIpv4Address', () => {
  it('accepts dotted quads and rejects junk', () => {
    expect(isValidIpv4Address('1.1.1.1')).toBe(true);
    expect(isValidIpv4Address('0.0.0.0')).toBe(true);
    expect(isValidIpv4Address('255.255.255.255')).toBe(true);
    expect(isValidIpv4Address('1.1.1')).toBe(false);
    expect(isValidIpv4Address('1.1.1.256')).toBe(false);
    expect(isValidIpv4Address('01.1.1.1')).toBe(false);
    expect(isValidIpv4Address('localhost')).toBe(false);
  });
});
