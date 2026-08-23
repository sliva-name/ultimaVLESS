import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeServer } from '@/test/factories';

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp') },
}));

vi.mock('./XrayService', () => ({
  xrayService: {
    getHealthStatus: vi.fn(),
    getActivePorts: vi.fn(),
  },
}));

vi.mock('./ConfigService', () => ({
  configService: {
    getConnectionMode: vi.fn(() => 'proxy'),
  },
}));

import { ConnectionMonitorService } from './ConnectionMonitorService';

describe('ConnectionMonitorService', () => {
  let monitor: ConnectionMonitorService;

  beforeEach(() => {
    monitor = new ConnectionMonitorService();
  });

  afterEach(() => {
    monitor.stopMonitoring();
  });

  it('clears the probe target when catalog identity is gone', () => {
    const server = makeServer({ uuid: 'live', address: '1.2.3.4' });
    monitor.startMonitoring(server);

    expect(monitor.syncCurrentServer([])).toBeNull();
    expect(monitor.getStatus().currentServer).toBeNull();
  });

  it('emits health-failure as a probe fact, not a session gate', () => {
    const server = makeServer({ uuid: 'live' });
    const failures: unknown[] = [];
    monitor.on('health-failure', (event) => failures.push(event));

    const emitted = monitor.recordError('blocked', server, {
      forceBlocking: true,
    });

    expect(emitted).toBe(true);
    expect(failures).toEqual([
      {
        server,
        reason: 'blocked',
        blocking: true,
      },
    ]);
  });
});
