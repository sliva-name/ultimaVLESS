import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import { makeServer } from '@/test/factories';
import { CONNECTION_MONITOR_TIMING } from './connectionMonitor/timing';

const {
  healthCheckIntervalMs,
  healthCheckInitialDelayMs,
  autoSwitchDelayMs,
  tunnelProbeStreakBeforeAction,
} = CONNECTION_MONITOR_TIMING;

/** Advances fake timers through N consecutive health-check ticks. */
async function advanceHealthCheckTicks(tickCount: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(healthCheckInitialDelayMs);
  for (let i = 1; i < tickCount; i += 1) {
    await vi.advanceTimersByTimeAsync(healthCheckIntervalMs);
  }
}

const mockState = vi.hoisted(() => ({
  tempDir: '',
}));
const configServiceMock = vi.hoisted(() => ({
  getServers: vi.fn(() => []),
  getConnectionMode: vi.fn(() => 'proxy'),
  setSelectedServerId: vi.fn(),
}));
const connectionStackServiceMock = vi.hoisted(() => ({
  transitionTo: vi.fn(async () => undefined),
  resetNetworkingStack: vi.fn(async () => undefined),
  cleanupAfterFailure: vi.fn(async () => undefined),
}));
const probeTcpPortMock = vi.hoisted(() => vi.fn(async () => true));
const probeHttpThroughProxyMock = vi.hoisted(() => vi.fn(async () => true));
const probeDirectInternetConnectivityMock = vi.hoisted(() =>
  vi.fn(async () => true),
);
const xrayServiceMock = vi.hoisted(() => ({
  getHealthStatus: vi.fn(() => ({
    state: 'running',
    ready: true,
    xrayRunning: true,
    lastStartAt: Date.now(),
    lastReadyAt: Date.now(),
    lastReadinessCheckAt: Date.now(),
    localProxyReachable: true,
    lastFailureAt: null,
    lastFailureReason: null,
    lastReadinessError: null,
  })),
}));

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => mockState.tempDir),
  },
}));

vi.mock('./ConfigService', () => ({
  configService: configServiceMock,
}));

vi.mock('./ConnectionStackService', () => ({
  connectionStackService: connectionStackServiceMock,
}));

vi.mock('./networkProbe', () => ({
  probeTcpPort: probeTcpPortMock,
  probeHttpThroughProxy: probeHttpThroughProxyMock,
  probeDirectInternetConnectivity: probeDirectInternetConnectivityMock,
}));

vi.mock('./XrayService', () => ({
  xrayService: xrayServiceMock,
}));

describe('ConnectionMonitorService', () => {
  let logPath: string;

  async function loadService() {
    vi.resetModules();
    const mod = await import('./ConnectionMonitorService');
    return mod.ConnectionMonitorService;
  }

  beforeEach(() => {
    const baseTempDir = process.env.TEMP || process.env.TMP || process.cwd();
    mockState.tempDir = fs.mkdtempSync(`${baseTempDir}/ultima-monitor-`);
    logPath = `${mockState.tempDir}/xray.log`;
    vi.useFakeTimers();
  });

  afterEach(async () => {
    const { logger } = await import('./LoggerService');
    await logger.flush();
    fs.rmSync(mockState.tempDir, { recursive: true, force: true });
    configServiceMock.getServers.mockReset();
    configServiceMock.getServers.mockReturnValue([]);
    configServiceMock.getConnectionMode.mockReset();
    configServiceMock.getConnectionMode.mockReturnValue('proxy');
    configServiceMock.setSelectedServerId.mockReset();
    connectionStackServiceMock.transitionTo.mockClear();
    connectionStackServiceMock.transitionTo.mockResolvedValue(undefined);
    connectionStackServiceMock.resetNetworkingStack.mockClear();
    connectionStackServiceMock.resetNetworkingStack.mockResolvedValue(undefined);
    connectionStackServiceMock.cleanupAfterFailure.mockClear();
    connectionStackServiceMock.cleanupAfterFailure.mockResolvedValue(undefined);
    probeTcpPortMock.mockReset();
    probeTcpPortMock.mockResolvedValue(true);
    probeHttpThroughProxyMock.mockReset();
    probeHttpThroughProxyMock.mockResolvedValue(true);
    probeDirectInternetConnectivityMock.mockReset();
    probeDirectInternetConnectivityMock.mockResolvedValue(true);
    xrayServiceMock.getHealthStatus.mockReset();
    xrayServiceMock.getHealthStatus.mockReturnValue({
      state: 'running',
      ready: true,
      xrayRunning: true,
      lastStartAt: Date.now(),
      lastReadyAt: Date.now(),
      lastReadinessCheckAt: Date.now(),
      localProxyReachable: true,
      lastFailureAt: null,
      lastFailureReason: null,
      lastReadinessError: null,
    });
    vi.useRealTimers();
    vi.resetModules();
  });

  it('ignores blocking log lines that existed before monitoring started', async () => {
    fs.writeFileSync(logPath, 'failed to dial old-server\n', 'utf8');
    const ConnectionMonitorService = await loadService();
    const svc = new ConnectionMonitorService();
    const server = makeServer({ uuid: 'server-1', name: 'Example' });

    const errorEvents: string[] = [];
    svc.on('error', (event) => {
      errorEvents.push(event.error ?? '');
    });

    svc.startMonitoring(server);
    await advanceHealthCheckTicks(1);

    expect(errorEvents).toHaveLength(0);
    expect(svc.getStatus().lastError).toBeNull();
  });

  it('records new blocking log lines that arrive after monitoring starts', async () => {
    fs.writeFileSync(logPath, 'startup ok\n', 'utf8');
    const ConnectionMonitorService = await loadService();
    const svc = new ConnectionMonitorService();
    const server = makeServer({ uuid: 'server-1', name: 'Example' });

    const errorPromise = new Promise<void>((resolve) => {
      svc.on('error', () => resolve());
    });

    svc.startMonitoring(server);
    fs.appendFileSync(logPath, 'failed to dial new-server\n', 'utf8');

    await advanceHealthCheckTicks(1);
    await errorPromise;

    expect(svc.getStatus().lastError).toContain('failed to dial');
    expect(svc.getStatus().blockedServers).toContain(server.uuid);
    expect(svc.getStatus().lastHealthCheckAt).not.toBeNull();
    expect(svc.getStatus().lastHealthState).toBe('failed');
  });

  it('marks the current server as blocked when recordError receives a blocking error', async () => {
    const ConnectionMonitorService = await loadService();
    const svc = new ConnectionMonitorService();
    const server = makeServer({ uuid: 'blocked-server' });

    svc.on('error', () => {});
    svc.startMonitoring(server);
    svc.recordError('failed to dial upstream');

    expect(svc.getStatus().blockedServers).toEqual(['blocked-server']);
    expect(svc.getStatus().lastError).toBe('failed to dial upstream');
    expect(svc.getStatus().lastHealthState).toBe('failed');
  });

  it('marks server blocked when tunnel probe failure is recorded (auto-switch path)', async () => {
    const ConnectionMonitorService = await loadService();
    const svc = new ConnectionMonitorService();
    const server = makeServer({ uuid: 'tunnel-dead' });

    svc.on('error', () => {});
    svc.startMonitoring(server);
    svc.recordError(
      'Remote endpoint check via proxy failed after retries (tunnel may be slow or blocked)',
    );

    expect(svc.getStatus().blockedServers).toEqual(['tunnel-dead']);
    expect(svc.getStatus().lastHealthState).toBe('failed');
  });

  it('handles unexpected disconnects through the public API', async () => {
    const ConnectionMonitorService = await loadService();
    const svc = new ConnectionMonitorService();
    const server = makeServer({ uuid: 'server-1', name: 'Example' });
    const disconnectedMessages: string[] = [];

    svc.on('error', () => {});
    svc.on('disconnected', (event) => {
      disconnectedMessages.push(event.message ?? '');
    });

    svc.startMonitoring(server);

    expect(svc.handleUnexpectedDisconnect('core exited')).toBe(true);
    expect(disconnectedMessages).toContain('Connection lost: core exited');
    expect(svc.getStatus().isConnected).toBe(false);
    expect(svc.getStatus().lastError).toBe('core exited');
  });

  it('does not set lastError on the first local proxy listener miss', async () => {
    probeTcpPortMock.mockResolvedValue(false);
    xrayServiceMock.getHealthStatus.mockReturnValue({
      state: 'degraded',
      ready: false,
      xrayRunning: true,
      lastStartAt: Date.now(),
      lastReadyAt: null,
      lastReadinessCheckAt: Date.now(),
      localProxyReachable: false,
      lastFailureAt: Date.now(),
      lastFailureReason: 'listeners unreachable',
      lastReadinessError: 'listeners unreachable',
    });

    const ConnectionMonitorService = await loadService();
    const svc = new ConnectionMonitorService();
    const server = makeServer({ uuid: 'server-1', name: 'Example' });

    svc.on('error', () => {});
    svc.startMonitoring(server);
    await advanceHealthCheckTicks(1);

    expect(svc.getStatus()).toMatchObject({
      lastHealthState: 'degraded',
      localProxyReachable: false,
      lastHealthFailureReason: 'listeners unreachable',
      lastError: null,
    });
  });

  it('sets lastError after consecutive local proxy listener misses', async () => {
    probeTcpPortMock.mockResolvedValue(false);
    xrayServiceMock.getHealthStatus.mockReturnValue({
      state: 'degraded',
      ready: false,
      xrayRunning: true,
      lastStartAt: Date.now(),
      lastReadyAt: null,
      lastReadinessCheckAt: Date.now(),
      localProxyReachable: false,
      lastFailureAt: Date.now(),
      lastFailureReason: 'listeners unreachable',
      lastReadinessError: 'listeners unreachable',
    });

    const ConnectionMonitorService = await loadService();
    const svc = new ConnectionMonitorService();
    const server = makeServer({ uuid: 'server-1', name: 'Example' });

    const errors: string[] = [];
    svc.on('error', (e) => errors.push(e.error ?? ''));
    svc.startMonitoring(server);
    await advanceHealthCheckTicks(
      CONNECTION_MONITOR_TIMING.localProxyStreakBeforeNotify,
    );

    expect(svc.getStatus()).toMatchObject({
      lastHealthState: 'degraded',
      localProxyReachable: false,
      lastHealthFailureReason: 'listeners unreachable',
      lastError: 'listeners unreachable',
    });
    expect(errors).toContain('listeners unreachable');
  });

  it('clears transient degraded health errors after a successful health check', async () => {
    probeTcpPortMock
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true);
    xrayServiceMock.getHealthStatus.mockReturnValue({
      state: 'degraded',
      ready: false,
      xrayRunning: true,
      lastStartAt: Date.now(),
      lastReadyAt: null,
      lastReadinessCheckAt: Date.now(),
      localProxyReachable: false,
      lastFailureAt: Date.now(),
      lastFailureReason: 'listeners unreachable',
      lastReadinessError: 'listeners unreachable',
    });
    const ConnectionMonitorService = await loadService();
    const svc = new ConnectionMonitorService();
    const server = makeServer({ uuid: 'server-1', name: 'Example' });

    svc.on('error', () => {});
    svc.startMonitoring(server);
    await (svc as any).checkConnectionHealth();
    await (svc as any).checkConnectionHealth();
    expect(svc.getStatus().lastError).toBe('listeners unreachable');

    await (svc as any).checkConnectionHealth();

    expect(svc.getStatus().lastHealthState).toBe('healthy');
    expect(svc.getStatus().lastHealthFailureReason).toBeNull();
    expect(svc.getStatus().lastError).toBeNull();
  });

  it('does not set lastError on the first consecutive HTTP tunnel probe failure', async () => {
    probeHttpThroughProxyMock.mockResolvedValue(false);
    const ConnectionMonitorService = await loadService();
    const svc = new ConnectionMonitorService();
    const server = makeServer({ uuid: 'server-1', name: 'Example' });

    svc.on('error', () => {});
    svc.startMonitoring(server);
    await advanceHealthCheckTicks(1);

    expect(svc.getStatus().lastError).toBeNull();
    expect(svc.getStatus().lastHealthState).toBe('degraded');
    expect(svc.getStatus().lastHealthFailureReason).toContain(
      'Remote endpoint check',
    );
  });

  it('sets lastError and schedules auto-switch after consecutive tunnel probe failures reach threshold', async () => {
    probeHttpThroughProxyMock.mockResolvedValue(false);
    const ConnectionMonitorService = await loadService();
    const svc = new ConnectionMonitorService();
    const server = makeServer({ uuid: 'server-1', name: 'Example' });

    const errors: string[] = [];
    svc.on('error', (e) => errors.push(e.error ?? ''));
    svc.startMonitoring(server);
    await advanceHealthCheckTicks(tunnelProbeStreakBeforeAction);

    expect(svc.getStatus().lastError).toContain('Remote endpoint check');
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(svc.getStatus().blockedServers).toEqual(['server-1']);
  });

  it('defers auto-switch when the host has no direct internet connectivity', async () => {
    const current = makeServer({ uuid: 'current', name: 'Current' });
    const next = makeServer({ uuid: 'next', name: 'Next' });
    configServiceMock.getServers.mockReturnValue([current, next]);
    probeHttpThroughProxyMock.mockResolvedValue(false);
    probeDirectInternetConnectivityMock.mockResolvedValue(false);

    const ConnectionMonitorService = await loadService();
    const svc = new ConnectionMonitorService();

    const errors: string[] = [];
    svc.on('error', (e) => errors.push(e.error ?? ''));
    svc.startMonitoring(current);
    await advanceHealthCheckTicks(tunnelProbeStreakBeforeAction);
    await vi.advanceTimersByTimeAsync(autoSwitchDelayMs);

    expect(svc.getStatus()).toMatchObject({
      lastHealthState: 'degraded',
      lastError: null,
      blockedServers: [],
    });
    expect(svc.getStatus().lastHealthFailureReason).toContain(
      'Host internet connectivity',
    );
    expect(errors).toHaveLength(0);
    expect(configServiceMock.setSelectedServerId).not.toHaveBeenCalled();
    expect(connectionStackServiceMock.transitionTo).not.toHaveBeenCalled();
  });

  it('does not use direct host connectivity as an offline guard in TUN mode', async () => {
    const current = makeServer({ uuid: 'current', name: 'Current' });
    const next = makeServer({ uuid: 'next', name: 'Next' });
    configServiceMock.getConnectionMode.mockReturnValue('tun');
    configServiceMock.getServers.mockReturnValue([current, next]);
    probeHttpThroughProxyMock.mockResolvedValue(false);
    probeDirectInternetConnectivityMock.mockResolvedValue(false);

    const ConnectionMonitorService = await loadService();
    const svc = new ConnectionMonitorService();

    svc.on('error', () => {});
    svc.startMonitoring(current);
    await advanceHealthCheckTicks(tunnelProbeStreakBeforeAction);

    expect(probeDirectInternetConnectivityMock).not.toHaveBeenCalled();
    expect(svc.getStatus().lastError).toContain('Remote endpoint check');
    expect(svc.getStatus().lastHealthFailureReason).toContain(
      'Remote endpoint check',
    );
    expect(svc.getStatus().blockedServers).toEqual(['current']);

    await vi.advanceTimersByTimeAsync(autoSwitchDelayMs);

    expect(configServiceMock.setSelectedServerId).not.toHaveBeenCalledWith(
      next.uuid,
    );
    expect(connectionStackServiceMock.transitionTo).toHaveBeenCalled();
  });

  it('uses advisory ping ranking to choose a reachable candidate from a large list quickly', async () => {
    const current = makeServer({ uuid: 'current', name: 'Current' });
    const deadServers = Array.from({ length: 40 }, (_, index) =>
      makeServer({
        uuid: `dead-${index}`,
        name: `Dead ${index}`,
        ping: null,
      }),
    );
    const good = makeServer({
      uuid: 'good',
      name: 'Good',
      ping: 12,
      pingTime: Date.now(),
      pingStale: false,
    });
    configServiceMock.getServers.mockReturnValue([
      current,
      ...deadServers,
      good,
    ]);
    xrayServiceMock.getHealthStatus
      .mockReturnValueOnce({
        state: 'failed',
        ready: false,
        xrayRunning: false,
        lastStartAt: Date.now(),
        lastReadyAt: null,
        lastReadinessCheckAt: Date.now(),
        localProxyReachable: false,
        lastFailureAt: Date.now(),
        lastFailureReason: 'current server failed',
        lastReadinessError: 'current server failed',
      })
      .mockReturnValue({
        state: 'running',
        ready: true,
        xrayRunning: true,
        lastStartAt: Date.now(),
        lastReadyAt: Date.now(),
        lastReadinessCheckAt: Date.now(),
        localProxyReachable: true,
        lastFailureAt: null,
        lastFailureReason: null,
        lastReadinessError: null,
      });

    const ConnectionMonitorService = await loadService();
    const svc = new ConnectionMonitorService();

    svc.on('error', () => {});
    svc.startMonitoring(current);
    await (svc as any).checkConnectionHealth();
    await vi.advanceTimersByTimeAsync(autoSwitchDelayMs);

    expect(connectionStackServiceMock.transitionTo).toHaveBeenCalledTimes(1);
    expect(connectionStackServiceMock.transitionTo.mock.calls[0]?.[0]).toBe(
      good,
    );
    expect(configServiceMock.setSelectedServerId).toHaveBeenLastCalledWith(
      good.uuid,
    );
  });

  it('skips a ping-positive server when real traffic validation fails', async () => {
    const current = makeServer({ uuid: 'current', name: 'Current' });
    const pingOnly = makeServer({
      uuid: 'ping-only',
      name: 'Ping Only',
      ping: 5,
      pingTime: Date.now(),
      pingStale: false,
    });
    const working = makeServer({
      uuid: 'working',
      name: 'Working',
      ping: 50,
      pingTime: Date.now(),
      pingStale: false,
    });
    configServiceMock.getServers.mockReturnValue([current, pingOnly, working]);
    xrayServiceMock.getHealthStatus
      .mockReturnValueOnce({
        state: 'failed',
        ready: false,
        xrayRunning: false,
        lastStartAt: Date.now(),
        lastReadyAt: null,
        lastReadinessCheckAt: Date.now(),
        localProxyReachable: false,
        lastFailureAt: Date.now(),
        lastFailureReason: 'current server failed',
        lastReadinessError: 'current server failed',
      })
      .mockReturnValue({
        state: 'running',
        ready: true,
        xrayRunning: true,
        lastStartAt: Date.now(),
        lastReadyAt: Date.now(),
        lastReadinessCheckAt: Date.now(),
        localProxyReachable: true,
        lastFailureAt: null,
        lastFailureReason: null,
        lastReadinessError: null,
      });
    probeHttpThroughProxyMock
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    const ConnectionMonitorService = await loadService();
    const svc = new ConnectionMonitorService();

    svc.on('error', () => {});
    svc.startMonitoring(current);
    await (svc as any).checkConnectionHealth();
    await vi.advanceTimersByTimeAsync(autoSwitchDelayMs);

    expect(connectionStackServiceMock.transitionTo).toHaveBeenCalledTimes(2);
    expect(connectionStackServiceMock.transitionTo.mock.calls[0]?.[0]).toBe(
      pingOnly,
    );
    expect(connectionStackServiceMock.transitionTo.mock.calls[1]?.[0]).toBe(
      working,
    );
    expect(svc.getStatus().blockedServers).toContain(pingOnly.uuid);
    expect(svc.getStatus().currentServer?.uuid).toBe(working.uuid);
  });

  it('auto-switches from failed Xray health without waiting for tunnel probe streaks', async () => {
    const current = makeServer({ uuid: 'current', name: 'Current' });
    const next = makeServer({ uuid: 'next', name: 'Next' });
    configServiceMock.getServers.mockReturnValue([current, next]);
    xrayServiceMock.getHealthStatus
      .mockReturnValueOnce({
        state: 'failed',
        ready: false,
        xrayRunning: false,
        lastStartAt: Date.now(),
        lastReadyAt: null,
        lastReadinessCheckAt: Date.now(),
        localProxyReachable: false,
        lastFailureAt: Date.now(),
        lastFailureReason: 'Xray reported remote server failure',
        lastReadinessError: 'Xray reported remote server failure',
      })
      .mockReturnValue({
        state: 'running',
        ready: true,
        xrayRunning: true,
        lastStartAt: Date.now(),
        lastReadyAt: Date.now(),
        lastReadinessCheckAt: Date.now(),
        localProxyReachable: true,
        lastFailureAt: null,
        lastFailureReason: null,
        lastReadinessError: null,
      });

    const ConnectionMonitorService = await loadService();
    const svc = new ConnectionMonitorService();

    svc.on('error', () => {});
    svc.startMonitoring(current);
    await (svc as any).checkConnectionHealth();

    expect(probeTcpPortMock).not.toHaveBeenCalled();
    expect(probeHttpThroughProxyMock).not.toHaveBeenCalled();
    expect(svc.getStatus()).toMatchObject({
      lastHealthState: 'failed',
      lastError: 'Xray reported remote server failure',
      blockedServers: ['current'],
    });

    await vi.advanceTimersByTimeAsync(autoSwitchDelayMs);

    expect(configServiceMock.setSelectedServerId).toHaveBeenCalledWith(
      next.uuid,
    );
    expect(connectionStackServiceMock.transitionTo).toHaveBeenCalled();
    expect(connectionStackServiceMock.transitionTo.mock.calls[0]?.[0]).toBe(
      next,
    );
  });

  it('ignores in-flight health check results after monitoring stops', async () => {
    let releaseProbe: (() => void) | null = null;
    probeTcpPortMock.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          releaseProbe = () => resolve(false);
        }),
    );

    const ConnectionMonitorService = await loadService();
    const svc = new ConnectionMonitorService();
    const server = makeServer({ uuid: 'server-1', name: 'Example' });

    svc.on('error', () => {});
    svc.startMonitoring(server);

    await vi.advanceTimersByTimeAsync(healthCheckInitialDelayMs);
    svc.stopMonitoring();
    releaseProbe?.();
    await Promise.resolve();

    expect(svc.getStatus()).toMatchObject({
      isConnected: false,
      currentServer: null,
      lastHealthState: 'idle',
      lastHealthFailureReason: null,
      lastError: null,
    });
  });
});
