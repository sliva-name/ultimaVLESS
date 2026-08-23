import { describe, expect, it, vi } from 'vitest';
import { makeServer } from '@/test/factories';
import { ConnectionManager } from './ConnectionManager';
import { ConnectionOperationAbortedError } from './abort';
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
vi.mock('@/main/services/SystemProxyService', () => ({
  systemProxyService: {},
}));
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
      consumePendingTunReconnect: vi.fn(() => null),
      peekPendingTunReconnect: vi.fn(() => null),
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
      setProbeTarget: vi.fn(),
      recordError: vi.fn(),
      handleCriticalConnectionFailure: vi.fn(() => false),
      noteFailure: vi.fn(),
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
      const fromConfig = (
        deps.configService as { getServers?: () => (typeof server)[] }
      ).getServers;
      return typeof fromConfig === 'function' ? fromConfig() : [server];
    };
    (deps as { serverRepository: unknown }).serverRepository = {
      get: (id: string) => listServers().find((item) => item.uuid === id),
      list: () => listServers(),
      saveAll: vi.fn(),
    };
  }

  return {
    controller: new ConnectionManager(deps as any),
    deps,
    server,
    start,
    stop,
    switchRuntime,
  };
}

describe('ConnectionManager', () => {
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

  it('cleanupAfterFailure tears the stack down and lands on failed', async () => {
    const { controller, stop } = createController();
    const phases: SessionPhase[] = [];
    controller.on('phase-changed', (phase: SessionPhase) => {
      phases.push(phase);
    });

    await controller.connect(makeServer({ uuid: 'server-1' }).uuid);
    phases.length = 0;
    await controller.cleanupAfterFailure();

    expect(stop).toHaveBeenCalled();
    expect(phases).toEqual(['disconnecting', 'failed']);
    expect(controller.getPhase()).toBe('failed');
    expect(controller.getLastError()).toBe('Connection cleanup');
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
    const { controller, server, start, switchRuntime, deps } = createController(
      {
        configService: {
          getServers: vi.fn(() => [server, next]),
          getConnectionMode: vi.fn((): ConnectionMode => 'proxy'),
          setSelectedServerId: vi.fn(),
          setPendingTunReconnect: vi.fn(),
          clearPendingTunReconnect: vi.fn(),
        },
      },
    );

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
        notifySwitching: vi.fn(),
        setProbeTarget: vi.fn(),
        recordError: vi.fn(),
        handleCriticalConnectionFailure: vi.fn(() => true),
        noteFailure: vi.fn(),
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
        notifySwitching: vi.fn(),
        setProbeTarget: vi.fn(),
        recordError: vi.fn(),
        handleCriticalConnectionFailure: vi.fn(() => true),
        noteFailure: vi.fn(),
      },
    });

    await controller.connect(server.uuid);
    controller.setAutoSwitchingEnabled(false);
    await controller.handleHealthFailure({
      server,
      reason: 'endpoint blocked',
      blocking: true,
    });

    expect(stop).toHaveBeenCalled();
    expect(deps.connectionMonitorService.stopMonitoring).toHaveBeenCalled();
    expect(controller.getPhase()).toBe('failed');
    expect(controller.getLastError()).toBe('endpoint blocked');
  });

  it('does not cleanup when a connect is aborted by a later disconnect', async () => {
    let releaseStart: (() => void) | undefined;
    const start = vi.fn(
      (_spec: unknown, signal: AbortSignal) =>
        new Promise<void>((resolve, reject) => {
          const onAbort = () => {
            reject(new ConnectionOperationAbortedError());
          };
          if (signal.aborted) {
            onAbort();
            return;
          }
          signal.addEventListener('abort', onAbort, { once: true });
          releaseStart = () => {
            signal.removeEventListener('abort', onAbort);
            resolve();
          };
        }),
    );
    const stop = vi.fn(async () => undefined);
    const { controller, server, deps } = createController({
      runtime: {
        start,
        stop,
        switch: vi.fn(async () => undefined),
        status: vi.fn(() => ({ xrayRunning: false })),
      },
    });

    const first = controller.connect(server.uuid);
    await Promise.resolve();
    const disconnecting = controller.disconnect();
    await expect(first).rejects.toBeInstanceOf(ConnectionOperationAbortedError);
    await disconnecting;

    expect(stop).toHaveBeenCalledTimes(1);
    expect(deps.connectionMonitorService.recordError).not.toHaveBeenCalled();
    expect(controller.getPhase()).toBe('idle');
    releaseStart?.();
  });

  it('marks a real connect failure as failed and does not enqueue a second teardown', async () => {
    const start = vi.fn(async () => {
      throw new Error('spawn failed');
    });
    const stop = vi.fn(async () => undefined);
    const { controller, server } = createController({
      runtime: {
        start,
        stop,
        switch: vi.fn(async () => undefined),
        status: vi.fn(() => ({ xrayRunning: false })),
      },
    });

    await expect(controller.connect(server.uuid)).rejects.toThrow(
      'spawn failed',
    );
    expect(stop).not.toHaveBeenCalled();
    expect(controller.getPhase()).toBe('failed');
    expect(controller.getLastError()).toBe('spawn failed');
  });

  it('lets a queued disconnect own the stack after a failed connect', async () => {
    const start = vi.fn(async () => {
      throw new Error('spawn failed');
    });
    const stop = vi.fn(async () => undefined);
    const { controller, server } = createController({
      runtime: {
        start,
        stop,
        switch: vi.fn(async () => undefined),
        status: vi.fn(() => ({ xrayRunning: false })),
      },
    });

    const first = controller.connect(server.uuid);
    const disconnecting = controller.disconnect();
    await expect(first).rejects.toThrow('spawn failed');
    await disconnecting;

    expect(stop).toHaveBeenCalledTimes(1);
    expect(controller.getPhase()).toBe('idle');
  });

  it('handleRuntimeFailure applies policy when the session is connected', async () => {
    const policy = {
      onHealthFailure: vi.fn(() => ({ action: 'disconnect' as const })),
    };
    const { controller, server, deps, stop } = createController({
      policy,
      connectionMonitorService: {
        getStatus: vi.fn(() => ({
          isConnected: true,
          currentServer: server,
          blockedServers: [],
          lastHealthState: 'failed',
        })),
        startMonitoring: vi.fn(),
        stopMonitoring: vi.fn(),
        notifySwitching: vi.fn(),
        setProbeTarget: vi.fn(),
        recordError: vi.fn(),
        handleCriticalConnectionFailure: vi.fn(() => true),
        noteFailure: vi.fn(),
      },
    });

    await controller.connect(server.uuid);
    await controller.handleRuntimeFailure('xray died', {
      localProxyReachable: false,
    });

    expect(deps.connectionMonitorService.noteFailure).toHaveBeenCalledWith(
      'xray died',
      { localProxyReachable: false },
    );
    expect(policy.onHealthFailure).toHaveBeenCalled();
    expect(stop).toHaveBeenCalled();
    expect(controller.getPhase()).toBe('failed');
    expect(controller.getLastError()).toBe('xray died');
  });

  it('remaps the live session id when catalog identity rotates', async () => {
    const previous = makeServer({ uuid: 'old-id', address: '1.2.3.4' });
    const rotated = makeServer({ uuid: 'new-id', address: '1.2.3.4' });
    const { controller } = createController({
      serverRepository: {
        get: (id: string) =>
          [previous, rotated].find((server) => server.uuid === id),
        list: () => [previous],
        saveAll: vi.fn(),
      },
    });

    await controller.connect(previous.uuid);
    const remapped = controller.reconcileActiveServer([rotated], [previous]);

    expect(remapped).toBe('new-id');
    expect(controller.getConnectionState()).toEqual({
      type: 'connected',
      serverId: 'new-id',
      mode: 'proxy',
    });
  });

  it('treats busy as in-flight session state only', async () => {
    const { controller, server } = createController();
    expect(controller.isBusy()).toBe(false);
    await controller.connect(server.uuid);
    expect(controller.isBusy()).toBe(false);
    expect(controller.getPhase()).toBe('connected');
  });

  it('consumes pending TUN relaunch from the session, not bootstrap', async () => {
    const consumePendingTunReconnect = vi.fn(() => 'server-1');
    const { controller, server, start } = createController({
      configService: {
        getServers: vi.fn(() => [server]),
        getConnectionMode: vi.fn((): ConnectionMode => 'tun'),
        getSelectedServerId: vi.fn(() => server.uuid),
        setSelectedServerId: vi.fn(),
        setPendingTunReconnect: vi.fn(),
        consumePendingTunReconnect,
        peekPendingTunReconnect: vi.fn(() => server.uuid),
        clearPendingTunReconnect: vi.fn(),
      },
    });

    await expect(controller.resumePendingTunAfterRelaunch()).resolves.toBe(
      true,
    );
    expect(consumePendingTunReconnect).toHaveBeenCalled();
    expect(start).toHaveBeenCalled();
    expect(controller.getPhase()).toBe('connected');
  });
});
