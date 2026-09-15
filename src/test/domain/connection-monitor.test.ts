import { describe, expect, it, vi } from 'vitest';
import { makeServer } from '@/test/factories';
import { ConnectionMonitorService } from '@/main/services/ConnectionMonitorService';

describe('connection monitor probe pause', () => {
  it('notifySwitching pauses probes without emitting disconnected', () => {
    const monitor = new ConnectionMonitorService();
    const from = makeServer({ uuid: 'from' });
    const to = makeServer({ uuid: 'to' });
    const disconnected = vi.fn();
    monitor.on('disconnected', disconnected);

    monitor.startMonitoring(from);
    expect(monitor.getStatus().probeArmed).toBe(true);

    monitor.notifySwitching(to, from.name);

    expect(monitor.getStatus().probeArmed).toBe(false);
    expect(monitor.getStatus().currentServer).toEqual(to);
    expect(disconnected).not.toHaveBeenCalled();

    monitor.stopMonitoring();
  });

  it('pauseProbes drops an armed session without clearing the target', () => {
    const monitor = new ConnectionMonitorService();
    const server = makeServer({ uuid: 'live' });
    const disconnected = vi.fn();
    monitor.on('disconnected', disconnected);

    monitor.startMonitoring(server);
    monitor.pauseProbes();

    expect(monitor.getStatus().probeArmed).toBe(false);
    expect(monitor.getStatus().currentServer).toEqual(server);
    expect(disconnected).not.toHaveBeenCalled();

    monitor.stopMonitoring();
  });
});
