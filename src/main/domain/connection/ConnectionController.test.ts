import { describe, expect, it, vi } from 'vitest';
import { makeServer } from '@/test/factories';
import { ConnectionController } from './ConnectionController';
import type { ConnectionMode } from '@/shared/types';
import type { SessionPhase } from '@/shared/ipc';

vi.mock('@/main/services/ConfigService', () => ({ configService: {} }));
vi.mock('@/main/services/ConnectionMonitorService', () => ({
  connectionMonitorService: {},
}));
vi.mock('@/main/services/PrivilegeService', () => ({
  hasTunPrivileges: vi.fn(),
  requestTunPrivilegesRelaunch: vi.fn(),
}));
vi.mock('@/main/services/SystemProxyService', () => ({ systemProxyService: {} }));
vi.mock('@/main/services/TunRouteService', () => ({ tunRouteService: {} }));
vi.mock('@/main/services/XrayService', () => ({ xrayService: {} }));

function createController(overrides: Partial<any> = {}) {
  const server = makeServer({ uuid: 'server-1' });
  const start = vi.fn(async () => undefined);
  const stop = vi.fn(async () => undefined);
  const switchRuntime = vi.fn(async () => undefined);
  const status = vi.fn(() => ({ xrayRunning: false }));
  const deps = {
    app: {
      releaseSingleInstanceLock: vi.fn(),
      quit: vi.fn(),
    },
    constants: { ports: { http: 10809, socks: 10808, api: 10810 } },
    configService: {
      getConnectionMode: vi.fn((): ConnectionMode => 'proxy'),
      setSelectedServerId: vi.fn(),
      setPendingTunReconnect: vi.fn(),
      clearPendingTunReconnect: vi.fn(),
    },
    connectionMonitorService: {
      getStatus: vi.fn(() => ({
        isConnected: false,
        currentServer: null,
        blockedServers: [],
        lastHealthState: 'idle',
      })),
      startMonitoring: vi.fn(),
      stopMonitoring: vi.fn(),
      pruneExpiredBlockedServers: vi.fn(),
      getAutoSwitchingEnabled: vi.fn(() => true),
      notifySwitching: vi.fn(),
      markServerAsBlocked: vi.fn(),
      recordError: vi.fn(),
      handleCriticalConnectionFailure: vi.fn(() => false),
    },
    hasTunPrivileges: vi.fn(async () => true),
    requestTunPrivilegesRelaunch: vi.fn(async () => false),
    proxyService: {},
    routeService: {
      isSupported: vi.fn(() => true),
      getUnsupportedReason: vi.fn(() => null),
    },
    coreService: {
      isRunning: vi.fn(() => false),
    },
    runtime: { start, stop, switch: switchRuntime, status },
    ...overrides,
  };

  if (!overrides.serverRepository) {
    const listServers = () => {
      const fromConfig = (deps.configService as { getServers?: () => typeof server[] })
        .getServers;
      return typeof fromConfig === 'function' ? fromConfig() : [server];
    };
    (deps as { serverRepository: unknown }).serverRepository = {
      get: (id: string) => listServers().find((item) => item.uuid === id),
      list: () => listServers(),
      saveAll: vi.fn(),
    };
  }

  return {
    controller: new ConnectionController(deps as any),
    deps,
    server,
    start,
    stop,
    switchRuntime,
  };
}

describe('ConnectionController', () => {
  it('connects through the runtime and starts monitoring', async () => {
    const { controller, deps, server, start, stop } = createController();

    await controller.connect(server.uuid);

    expect(start).toHaveBeenCalledWith(
      {
        server,
        mode: 'proxy',
        ports: { http: 10809, socks: 10808, api: 10810 },
      },
      expect.any(AbortSignal),
    );
    expect(stop).not.toHaveBeenCalled();
    expect(deps.configService.setSelectedServerId).toHaveBeenCalledWith(
      server.uuid,
    );
    expect(deps.connectionMonitorService.startMonitoring).toHaveBeenCalledWith(
      server,
    );
    expect(controller.isBusy()).toBe(false);
    expect(controller.getPhase()).toBe('connected');
    expect(controller.getConnectionState()).toEqual({
      type: 'connected',
      serverId: server.uuid,
      mode: 'proxy',
    });
  });

  it('emits phase transitions without a separate busy channel', async () => {
    const { controller, server } = createController();
    const phases: SessionPhase[] = [];
    controller.on('phase-changed', (phase: SessionPhase) => {
      phases.push(phase);
    });

    await controller.connect(server.uuid);
    await controller.disconnect();

    expect(phases).toEqual([
      'connecting',
      'connected',
      'disconnecting',
      'idle',
    ]);
  });

  it('is already in disconnecting when stopMonitoring runs synchronously', async () => {
    const phasesAtStop: SessionPhase[] = [];
    const { controller, deps, server } = createController({
      connectionMonitorService: {
        getStatus: vi.fn(() => ({ isConnected: true, currentServer: server })),
        startMonitoring: vi.fn(),
        stopMonitoring: vi.fn(() => {
          phasesAtStop.push(controller.getPhase());
          expect(controller.isBusy()).toBe(true);
        }),
      },
    });

    await controller.connect(server.uuid);
    await controller.disconnect();

    expect(deps.connectionMonitorService.stopMonitoring).toHaveBeenCalled();
    expect(phasesAtStop).toEqual(['disconnecting']);
    expect(controller.getPhase()).toBe('idle');
  });

  it('cleanupAfterFailure uses disconnecting then idle, not failed', async () => {
    const { controller, stop } = createController();
    const phases: SessionPhase[] = [];
    controller.on('phase-changed', (phase: SessionPhase) => {
      phases.push(phase);
    });

    await controller.connect(makeServer({ uuid: 'server-1' }).uuid);
    phases.length = 0;
    await controller.cleanupAfterFailure();

    expect(stop).toHaveBeenCalled();
    expect(phases).toEqual(['disconnecting', 'idle']);
    expect(controller.getPhase()).toBe('idle');
  });

  it('uses the platform-specific privilege path for TUN connections', async () => {
    const { controller, deps, server, start } = createController({
      configService: {
        getServers: vi.fn(() => [makeServer({ uuid: 'server-1' })]),
        getConnectionMode: vi.fn((): ConnectionMode => 'tun'),
        setSelectedServerId: vi.fn(),
        setPendingTunReconnect: vi.fn(),
        clearPendingTunReconnect: vi.fn(),
      },
      hasTunPrivileges: vi.fn(async () => false),
      requestTunPrivilegesRelaunch: vi.fn(async () => true),
    });

    if (process.platform === 'win32') {
      await expect(controller.connect(server.uuid)).rejects.toMatchObject({
        relaunched: true,
      });
      expect(deps.configService.setPendingTunReconnect).toHaveBeenCalledWith(
        server.uuid,
      );
      expect(deps.app.quit).toHaveBeenCalledTimes(1);
      expect(start).not.toHaveBeenCalled();
      // Must stay connecting (not failed) so shutdown can unwind cleanly
      // without looking like a hard connect error.
      expect(controller.getPhase()).toBe('connecting');
    } else {
      await expect(controller.connect(server.uuid)).rejects.toThrow(
        /root privileges/,
      );
      expect(deps.configService.setPendingTunReconnect).not.toHaveBeenCalled();
      expect(deps.app.quit).not.toHaveBeenCalled();
    }
  });

  it('preserves pending TUN reconnect across shutdown disconnect', async () => {
    const clearPendingTunReconnect = vi.fn();
    const { controller, server } = createController({
      configService: {
        getServers: vi.fn(() => [server]),
        getConnectionMode: vi.fn((): ConnectionMode => 'proxy'),
        setSelectedServerId: vi.fn(),
        setPendingTunReconnect: vi.fn(),
        clearPendingTunReconnect,
      },
    });

    await controller.connect(server.uuid);
    clearPendingTunReconnect.mockClear();
    await controller.disconnect({ preservePendingTunReconnect: true });

    expect(clearPendingTunReconnect).not.toHaveBeenCalled();
    expect(controller.getPhase()).toBe('idle');
  });

  it('clears pending TUN reconnect on user disconnect', async () => {
    const clearPendingTunReconnect = vi.fn();
    const { controller, server } = createController({
      configService: {
        getServers: vi.fn(() => [server]),
        getConnectionMode: vi.fn((): ConnectionMode => 'proxy'),
        setSelectedServerId: vi.fn(),
        setPendingTunReconnect: vi.fn(),
        clearPendingTunReconnect,
      },
    });

    await controller.connect(server.uuid);
    clearPendingTunReconnect.mockClear();
    await controller.disconnect();

    expect(clearPendingTunReconnect).toHaveBeenCalledTimes(1);
  });

  it('switches through runtime.switch instead of a teardown flag', async () => {
    const next = makeServer({ uuid: 'server-2' });
    const { controller, server, start, switchRuntime, deps } = createController({
      configService: {
        getServers: vi.fn(() => [server, next]),
        getConnectionMode: vi.fn((): ConnectionMode => 'proxy'),
        setSelectedServerId: vi.fn(),
        setPendingTunReconnect: vi.fn(),
        clearPendingTunReconnect: vi.fn(),
      },
    });

    await controller.connect(server.uuid);
    start.mockClear();
    await controller.switchToServer(next);

    expect(start).not.toHaveBeenCalled();
    expect(switchRuntime).toHaveBeenCalledWith(
      {
        server: next,
        mode: 'proxy',
        ports: { http: 10809, socks: 10808, api: 10810 },
      },
      expect.any(AbortSignal),
    );
    expect(controller.getConnectionState()).toEqual({
      type: 'connected',
      serverId: next.uuid,
      mode: 'proxy',
    });
    expect(deps.connectionMonitorService.startMonitoring).toHaveBeenCalledWith(
      next,
    );
  });

  it('applies connection policy on health failure instead of monitor-owned switch', async () => {
    const next = makeServer({ uuid: 'server-2' });
    const { controller, server, switchRuntime, deps } = createController({
      configService: {
        getServers: vi.fn(() => [server, next]),
        getConnectionMode: vi.fn((): ConnectionMode => 'proxy'),
        setSelectedServerId: vi.fn(),
        setPendingTunReconnect: vi.fn(),
        clearPendingTunReconnect: vi.fn(),
      },
      connectionMonitorService: {
        getStatus: vi.fn(() => ({
          isConnected: true,
          currentServer: server,
          blockedServers: [],
          lastHealthState: 'healthy',
          localProxyReachable: true,
        })),
        startMonitoring: vi.fn(),
        stopMonitoring: vi.fn(),
        pruneExpiredBlockedServers: vi.fn(),
        getAutoSwitchingEnabled: vi.fn(() => true),
        notifySwitching: vi.fn(),
        markServerAsBlocked: vi.fn(),
        recordError: vi.fn(),
        handleCriticalConnectionFailure: vi.fn(() => true),
      },
    });

    await controller.connect(server.uuid);
    vi.useFakeTimers();
    try {
      await controller.handleHealthFailure({
        server,
        reason: 'endpoint blocked',
        blocking: true,
      });
      await vi.advanceTimersByTimeAsync(2_000);
      await vi.runAllTimersAsync();
    } finally {
      vi.useRealTimers();
    }

    expect(switchRuntime).toHaveBeenCalledWith(
      expect.objectContaining({ server: next, mode: 'proxy' }),
      expect.any(AbortSignal),
    );
    expect(deps.connectionMonitorService.notifySwitching).toHaveBeenCalledWith(
      next,
      server.name,
    );
    expect(deps.connectionMonitorService.startMonitoring).toHaveBeenCalledWith(
      next,
    );
  });

  it('disconnects when policy says not to auto-switch', async () => {
    const { controller, server, stop, deps } = createController({
      connectionMonitorService: {
        getStatus: vi.fn(() => ({
          isConnected: true,
          currentServer: server,
          blockedServers: [],
          lastHealthState: 'failed',
        })),
        startMonitoring: vi.fn(),
        stopMonitoring: vi.fn(),
        pruneExpiredBlockedServers: vi.fn(),
        getAutoSwitchingEnabled: vi.fn(() => false),
        notifySwitching: vi.fn(),
        markServerAsBlocked: vi.fn(),
        recordError: vi.fn(),
        handleCriticalConnectionFailure: vi.fn(() => true),
      },
    });

    await controller.connect(server.uuid);
    await controller.handleHealthFailure({
      server,
      reason: 'endpoint blocked',
      blocking: true,
    });

    expect(stop).toHaveBeenCalled();
    expect(deps.connectionMonitorService.stopMonitoring).toHaveBeenCalled();
    expect(controller.getPhase()).toBe('idle');
  });
});
