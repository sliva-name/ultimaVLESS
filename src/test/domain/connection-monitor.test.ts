import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeServer } from '@/test/factories';
import { ConnectionMonitorService } from '@/main/services/ConnectionMonitorService';
import {
  runConnectionHealthProbe,
  type ConnectionHealthProbeResult,
} from '@/main/services/connectionMonitor/healthProbe';

vi.mock('@/main/services/XrayService', () => ({
  xrayService: {
    getHealthStatus: vi.fn(() => ({ state: 'healthy' })),
    getActivePorts: vi.fn(() => ({ socks: 10808, http: 10809, api: 10810 })),
  },
}));
vi.mock('@/main/services/ConfigService', () => ({
  configService: { getConnectionMode: vi.fn(() => 'tun') },
}));
vi.mock('@/main/services/connectionMonitor/healthProbe', () => ({
  runConnectionHealthProbe: vi.fn(),
}));

const probe = vi.mocked(runConnectionHealthProbe);
const TUNNEL_FAILED: ConnectionHealthProbeResult = {
  type: 'tunnel-failed',
  localProxyReachable: true,
  failureReason:
    'Remote endpoint check via proxy failed after retries (tunnel may be slow or blocked)',
};

afterEach(() => {
  probe.mockReset();
});

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

describe('connection monitor pre-switch recheck', () => {
  it.each([
    [{ type: 'healthy', localProxyReachable: true }, 'recovered', 'healthy'],
    [
      {
        type: 'host-offline',
        localProxyReachable: true,
        failureReason: 'Host internet connectivity is unavailable',
      },
      'host-offline',
      'degraded',
    ],
    [TUNNEL_FAILED, 'still-failing', 'idle'],
  ] as const)('maps a %o probe to %s', async (result, verdict, healthState) => {
    const monitor = new ConnectionMonitorService();
    probe.mockResolvedValue(result);
    monitor.startMonitoring(makeServer({ uuid: 'live' }));

    await expect(monitor.recheckBeforeSwitch()).resolves.toBe(verdict);
    expect(probe).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionMode: 'tun',
        tunnelProbe: expect.objectContaining({ attempts: 1 }),
      }),
    );
    expect(monitor.getStatus().lastHealthState).toBe(healthState);

    monitor.stopMonitoring();
  });

  it('leaves the failure standing when probes are not armed', async () => {
    const monitor = new ConnectionMonitorService();

    await expect(monitor.recheckBeforeSwitch()).resolves.toBe('still-failing');
    expect(probe).not.toHaveBeenCalled();
  });

  it('counts a later outage from scratch after a recovered recheck', async () => {
    const monitor = new ConnectionMonitorService();
    const healthFailure = vi.fn();
    monitor.on('health-failure', healthFailure);
    monitor.on('error', () => undefined);
    probe.mockResolvedValue(TUNNEL_FAILED);

    vi.useFakeTimers();
    try {
      monitor.startMonitoring(makeServer({ uuid: 'live' }));
      await vi.advanceTimersByTimeAsync(5_000 + 15_000);
      expect(healthFailure).toHaveBeenCalledTimes(1);

      probe.mockResolvedValueOnce({
        type: 'healthy',
        localProxyReachable: true,
      });
      await expect(monitor.recheckBeforeSwitch()).resolves.toBe('recovered');

      await vi.advanceTimersByTimeAsync(15_000 * 2);
      expect(healthFailure).toHaveBeenCalledTimes(2);
    } finally {
      monitor.stopMonitoring();
      vi.useRealTimers();
    }
  });
});
