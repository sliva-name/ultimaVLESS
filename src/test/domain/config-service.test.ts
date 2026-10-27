import { describe, expect, it, type Mock } from 'vitest';
import { ConfigService } from '@/main/services/ConfigService';
import { getAppStore } from '@/main/infrastructure/persistence/appStore';
import { DEFAULT_PERFORMANCE_SETTINGS } from '@/shared/types';

/** An app-config.json kept in memory across "relaunches". */
function useMemoryStore(initial: Record<string, unknown> = {}) {
  const values = new Map<string, unknown>(Object.entries(initial));
  const store = getAppStore() as unknown as { get: Mock; set: Mock };
  store.get.mockImplementation((key: string) => values.get(key));
  store.set.mockImplementation((key: string, value: unknown) => {
    values.set(key, value);
  });
  return values;
}

describe('real delay as the default ping method', () => {
  it('moves the stored TCP default to real delay once', () => {
    const values = useMemoryStore({
      performanceSettings: {
        ...DEFAULT_PERFORMANCE_SETTINGS,
        bypassDomains: ['example.com'],
        pingMethod: 'tcp',
      },
    });

    const config = new ConfigService();
    expect(config.getPerformanceSettings()).toMatchObject({
      pingMethod: 'real',
      bypassDomains: ['example.com'],
    });

    // A user who switches back to TCP keeps it after a relaunch.
    config.setPerformanceSettings({
      ...config.getPerformanceSettings(),
      pingMethod: 'tcp',
    });
    expect(new ConfigService().getPerformanceSettings().pingMethod).toBe('tcp');
    expect(values.get('realDelayDefaultApplied')).toBe(true);
  });

  it('starts fresh installs on real delay', () => {
    useMemoryStore();
    expect(new ConfigService().getPerformanceSettings().pingMethod).toBe(
      'real',
    );
  });
});

describe('auto-switch toggle persistence', () => {
  it('is on for configs that never stored it and survives a relaunch', () => {
    const values = useMemoryStore();

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
