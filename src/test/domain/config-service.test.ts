import { describe, expect, it, type Mock } from 'vitest';
import { ConfigService } from '@/main/services/ConfigService';
import { getAppStore } from '@/main/infrastructure/persistence/appStore';

describe('auto-switch toggle persistence', () => {
  it('is on for configs that never stored it and survives a relaunch', () => {
    const values = new Map<string, unknown>();
    const store = getAppStore() as unknown as { get: Mock; set: Mock };
    store.get.mockImplementation((key: string) => values.get(key));
    store.set.mockImplementation((key: string, value: unknown) => {
      values.set(key, value);
    });

    const config = new ConfigService();
    expect(config.getAutoSwitchingEnabled()).toBe(true);

    config.setAutoSwitchingEnabled(false);
    expect(values.get('autoSwitchingEnabled')).toBe(false);
    // A relaunched process reads the same app-config.json.
    expect(new ConfigService().getAutoSwitchingEnabled()).toBe(false);

    config.setAutoSwitchingEnabled(true);
    expect(new ConfigService().getAutoSwitchingEnabled()).toBe(true);
  });
});
