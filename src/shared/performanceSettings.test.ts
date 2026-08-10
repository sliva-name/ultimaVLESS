import { describe, expect, it } from 'vitest';
import { normalizePerformanceSettings } from './performanceSettings';

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
});
