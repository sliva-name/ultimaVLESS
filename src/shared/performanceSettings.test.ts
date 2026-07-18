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
});
