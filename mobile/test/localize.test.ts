import { describe, expect, it } from 'vitest';
import { localizeError } from '@/shared/localizeError';

describe('Android error messages', () => {
  it('are translated for the Russian UI', () => {
    for (const message of [
      'VPN permission was denied',
      'VPN was turned off by another VPN app',
      'VPN service stopped',
      'Xray did not open the local proxy on 127.0.0.1:10808',
    ]) {
      const translated = localizeError(message, 'ru');
      expect(translated, message).not.toBe(message);
      expect(translated, message).not.toMatch(/\b(?:was|did|not|by)\b/);
    }
  });
});
