import { describe, expect, it, vi } from 'vitest';
import { makeServer } from '@/test/factories';
import { ConnectionManager } from '@/main/domain/connection/ConnectionManager';
import { ConnectionOperationAbortedError } from '@/main/domain/connection/abort';
import {
  activeServerIdFromState,
  connectionStateToSessionPhase,
  isConnectionStateInFlight,
  lastErrorFromState,
  type ConnectionState,
} from '@/main/domain/connection/ConnectionState';
import { createAutoSwitchPolicy } from '@/main/domain/connection/ConnectionPolicy';
import { SessionPolicyState } from '@/main/domain/connection/SessionPolicyState';
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

function createSession(overrides: Partial<any> = {}) {
  const server = makeServer({ uuid: 'server-1' });
  const start = vi.fn(async () => undefined);
  const stop = vi.fn(async () => undefined);
  const switchRuntime = vi.fn(async () => undefined);
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
      startMonitoring: vi.fn(),
      stopMonitoring: vi.fn(),
      notifySwitching: vi.fn(),
      setProbeTarget: vi.fn(),
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
    runtime: {
      start,
      stop,
      switch: switchRuntime,
      status: vi.fn(() => ({ xrayRunning: false })),
    },
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
    session: new ConnectionManager(deps as any),
    deps,
    server,
    start,
    stop,
    switchRuntime,
  };
}

describe('session lifecycle', () => {
  it('connects through the runtime and arms health probes', async () => {
    const { session, deps, server, start, stop } = createSession();

    await session.connect(server.uuid);

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
    expect(session.isBusy()).toBe(false);
    expect(session.getPhase()).toBe('connected');
    expect(session.getConnectionState()).toEqual({
      type: 'connected',
      serverId: server.uuid,
      mode: 'proxy',
    });
  });

  it('emits connecting → connected → disconnecting → idle', async () => {
    const { session, server } = createSession();
    const phases: SessionPhase[] = [];
    session.on('phase-changed', (phase: SessionPhase) => {
      phases.push(phase);
    });

    await session.connect(server.uuid);
    await session.disconnect();

    expect(phases).toEqual([
      'connecting',
      'connected',
      'disconnecting',
      'idle',
    ]);
  });

  it('is already disconnecting when probes stop synchronously', async () => {
    const phasesAtStop: SessionPhase[] = [];
    const { session, deps, server } = createSession({
      connectionMonitorService: {
        startMonitoring: vi.fn(),
        stopMonitoring: vi.fn(() => {
          phasesAtStop.push(session.getPhase());
          expect(session.isBusy()).toBe(true);
        }),
        notifySwitching: vi.fn(),
        setProbeTarget: vi.fn(),
        noteFailure: vi.fn(),
      },
    });

    await session.connect(server.uuid);
    await session.disconnect();

    expect(deps.connectionMonitorService.stopMonitoring).toHaveBeenCalled();
    expect(phasesAtStop).toEqual(['disconnecting']);
    expect(session.getPhase()).toBe('idle');
  });

  it('failure cleanup tears the stack down and lands on failed', async () => {
    const { session, stop } = createSession();
    const phases: SessionPhase[] = [];
    session.on('phase-changed', (phase: SessionPhase) => {
      phases.push(phase);
    });

    await session.connect(makeServer({ uuid: 'server-1' }).uuid);
    phases.length = 0;
    await session.cleanupAfterFailure();

    expect(stop).toHaveBeenCalled();
    expect(phases).toEqual(['disconnecting', 'failed']);
    expect(session.getPhase()).toBe('failed');
    expect(session.getLastError()).toBe('Connection cleanup');
  });

  it('uses the platform privilege path for TUN and keeps connecting across UAC', async () => {
    const { session, deps, server, start } = createSession({
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
      await expect(session.connect(server.uuid)).rejects.toMatchObject({
        relaunched: true,
      });
      expect(deps.configService.setPendingTunReconnect).toHaveBeenCalledWith(
        server.uuid,
      );
      expect(deps.app.quit).toHaveBeenCalledTimes(1);
      expect(start).not.toHaveBeenCalled();
      expect(session.getPhase()).toBe('connecting');
    } else {
      await expect(session.connect(server.uuid)).rejects.toThrow(
        /root privileges/,
      );
      expect(deps.configService.setPendingTunReconnect).not.toHaveBeenCalled();
      expect(deps.app.quit).not.toHaveBeenCalled();
    }
  });

  it('preserves pending TUN reconnect across shutdown disconnect', async () => {
    const clearPendingTunReconnect = vi.fn();
    const { session, server } = createSession({
      configService: {
        getServers: vi.fn(() => [server]),
        getConnectionMode: vi.fn((): ConnectionMode => 'proxy'),
        setSelectedServerId: vi.fn(),
        setPendingTunReconnect: vi.fn(),
        clearPendingTunReconnect,
      },
    });

    await session.connect(server.uuid);
    clearPendingTunReconnect.mockClear();
    await session.disconnect({ preservePendingTunReconnect: true });

    expect(clearPendingTunReconnect).not.toHaveBeenCalled();
    expect(session.getPhase()).toBe('idle');
  });

  it('clears pending TUN reconnect on user disconnect', async () => {
    const clearPendingTunReconnect = vi.fn();
    const { session, server } = createSession({
      configService: {
        getServers: vi.fn(() => [server]),
        getConnectionMode: vi.fn((): ConnectionMode => 'proxy'),
        setSelectedServerId: vi.fn(),
        setPendingTunReconnect: vi.fn(),
        clearPendingTunReconnect,
      },
    });

    await session.connect(server.uuid);
    clearPendingTunReconnect.mockClear();
    await session.disconnect();

    expect(clearPendingTunReconnect).toHaveBeenCalledTimes(1);
  });

  it('switches through runtime.switch and retargets probes', async () => {
    const next = makeServer({ uuid: 'server-2' });
    const { session, server, start, switchRuntime, deps } = createSession({
      configService: {
        getServers: vi.fn(() => [server, next]),
        getConnectionMode: vi.fn((): ConnectionMode => 'proxy'),
        setSelectedServerId: vi.fn(),
        setPendingTunReconnect: vi.fn(),
        clearPendingTunReconnect: vi.fn(),
      },
    });

    await session.connect(server.uuid);
    start.mockClear();
    await session.switchToServer(next);

    expect(start).not.toHaveBeenCalled();
    expect(switchRuntime).toHaveBeenCalledWith(
      {
        server: next,
        mode: 'proxy',
        ports: { http: 10809, socks: 10808, api: 10810 },
      },
      expect.any(AbortSignal),
    );
    expect(session.getConnectionState()).toEqual({
      type: 'connected',
      serverId: next.uuid,
      mode: 'proxy',
    });
    expect(deps.connectionMonitorService.startMonitoring).toHaveBeenCalledWith(
      next,
    );
  });

  it('auto-switches on a blocking health failure', async () => {
    const next = makeServer({ uuid: 'server-2' });
    const { session, server, switchRuntime, deps } = createSession({
      configService: {
        getServers: vi.fn(() => [server, next]),
        getConnectionMode: vi.fn((): ConnectionMode => 'proxy'),
        setSelectedServerId: vi.fn(),
        setPendingTunReconnect: vi.fn(),
        clearPendingTunReconnect: vi.fn(),
      },
    });

    await session.connect(server.uuid);
    vi.useFakeTimers();
    try {
      await session.handleHealthFailure({
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

  it('disconnects to failed when auto-switch is off', async () => {
    const { session, server, stop, deps } = createSession();

    await session.connect(server.uuid);
    session.setAutoSwitchingEnabled(false);
    await session.handleHealthFailure({
      server,
      reason: 'endpoint blocked',
      blocking: true,
    });

    expect(stop).toHaveBeenCalled();
    expect(deps.connectionMonitorService.stopMonitoring).toHaveBeenCalled();
    expect(session.getPhase()).toBe('failed');
    expect(session.getLastError()).toBe('endpoint blocked');
  });

  it('does not treat a later disconnect as a connect failure', async () => {
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
    const { session, server } = createSession({
      runtime: {
        start,
        stop,
        switch: vi.fn(async () => undefined),
        status: vi.fn(() => ({ xrayRunning: false })),
      },
    });

    const first = session.connect(server.uuid);
    await Promise.resolve();
    const disconnecting = session.disconnect();
    await expect(first).rejects.toBeInstanceOf(ConnectionOperationAbortedError);
    await disconnecting;

    expect(stop).toHaveBeenCalledTimes(1);
    expect(session.getPhase()).toBe('idle');
    releaseStart?.();
  });

  it('marks a real connect failure as failed without a second teardown', async () => {
    const start = vi.fn(async () => {
      throw new Error('spawn failed');
    });
    const stop = vi.fn(async () => undefined);
    const { session, server } = createSession({
      runtime: {
        start,
        stop,
        switch: vi.fn(async () => undefined),
        status: vi.fn(() => ({ xrayRunning: false })),
      },
    });

    await expect(session.connect(server.uuid)).rejects.toThrow('spawn failed');
    expect(stop).not.toHaveBeenCalled();
    expect(session.getPhase()).toBe('failed');
    expect(session.getLastError()).toBe('spawn failed');
  });

  it('lets a queued disconnect own the stack after a failed connect', async () => {
    const start = vi.fn(async () => {
      throw new Error('spawn failed');
    });
    const stop = vi.fn(async () => undefined);
    const { session, server } = createSession({
      runtime: {
        start,
        stop,
        switch: vi.fn(async () => undefined),
        status: vi.fn(() => ({ xrayRunning: false })),
      },
    });

    const first = session.connect(server.uuid);
    const disconnecting = session.disconnect();
    await expect(first).rejects.toThrow('spawn failed');
    await disconnecting;

    expect(stop).toHaveBeenCalledTimes(1);
    expect(session.getPhase()).toBe('idle');
  });

  it('runtime death while connected is a session health decision', async () => {
    const policy = {
      onHealthFailure: vi.fn(() => ({ action: 'disconnect' as const })),
    };
    const { session, server, deps, stop } = createSession({ policy });

    await session.connect(server.uuid);
    await session.handleRuntimeFailure('xray died', {
      localProxyReachable: false,
    });

    expect(deps.connectionMonitorService.noteFailure).toHaveBeenCalledWith(
      'xray died',
      { localProxyReachable: false },
    );
    expect(policy.onHealthFailure).toHaveBeenCalled();
    expect(stop).toHaveBeenCalled();
    expect(session.getPhase()).toBe('failed');
    expect(session.getLastError()).toBe('xray died');
  });

  it('remaps the live session id when catalog identity rotates', async () => {
    const previous = makeServer({ uuid: 'old-id', address: '1.2.3.4' });
    const rotated = makeServer({ uuid: 'new-id', address: '1.2.3.4' });
    const { session } = createSession({
      serverRepository: {
        get: (id: string) =>
          [previous, rotated].find((server) => server.uuid === id),
        list: () => [previous],
        saveAll: vi.fn(),
      },
    });

    await session.connect(previous.uuid);
    const remapped = session.reconcileActiveServer([rotated], [previous]);

    expect(remapped).toBe('new-id');
    expect(session.getConnectionState()).toEqual({
      type: 'connected',
      serverId: 'new-id',
      mode: 'proxy',
    });
  });

  it('does not remap a live session onto a CDN sibling that only shares host:port', async () => {
    const previous = makeServer({
      uuid: 'old-id',
      address: '1.2.3.4',
      sni: 'a.example',
    });
    const sibling = makeServer({
      uuid: 'new-id',
      address: '1.2.3.4',
      sni: 'b.example',
    });
    const { session } = createSession({
      serverRepository: {
        get: (id: string) =>
          [previous, sibling].find((server) => server.uuid === id),
        list: () => [previous],
        saveAll: vi.fn(),
      },
    });

    await session.connect(previous.uuid);
    const remapped = session.reconcileActiveServer([sibling], [previous]);

    expect(remapped).toBe('old-id');
    expect(session.getConnectionState()).toEqual({
      type: 'connected',
      serverId: 'old-id',
      mode: 'proxy',
    });
  });

  it('treats busy as in-flight session state only', async () => {
    const { session, server } = createSession();
    expect(session.isBusy()).toBe(false);
    await session.connect(server.uuid);
    expect(session.isBusy()).toBe(false);
    expect(session.getPhase()).toBe('connected');
  });

  it('consumes pending TUN relaunch from the session, not bootstrap', async () => {
    const consumePendingTunReconnect = vi.fn(() => 'server-1');
    const { session, server, start } = createSession({
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

    await expect(session.resumePendingTunAfterRelaunch()).resolves.toBe(true);
    expect(consumePendingTunReconnect).toHaveBeenCalled();
    expect(start).toHaveBeenCalled();
    expect(session.getPhase()).toBe('connected');
  });
});

describe('session state projection', () => {
  it('maps ConnectionState onto SessionPhase', () => {
    const cases: Array<[ConnectionState, string]> = [
      [{ type: 'disconnected' }, 'idle'],
      [
        { type: 'starting', serverId: 'a', mode: 'proxy', generation: 1 },
        'connecting',
      ],
      [{ type: 'connected', serverId: 'a', mode: 'tun' }, 'connected'],
      [
        {
          type: 'switching',
          from: 'a',
          to: 'b',
          mode: 'proxy',
          generation: 2,
        },
        'switching',
      ],
      [{ type: 'stopping', generation: 3, outcome: 'idle' }, 'disconnecting'],
      [{ type: 'failed', reason: { message: 'boom' } }, 'failed'],
    ];

    for (const [state, phase] of cases) {
      expect(connectionStateToSessionPhase(state)).toBe(phase);
    }
  });

  it('exposes lastError only from failed or a failing stop', () => {
    expect(lastErrorFromState({ type: 'disconnected' })).toBeNull();
    expect(
      lastErrorFromState({ type: 'failed', reason: { message: 'boom' } }),
    ).toBe('boom');
    expect(
      lastErrorFromState({
        type: 'stopping',
        generation: 1,
        outcome: 'failed',
        reason: { message: 'dead' },
      }),
    ).toBe('dead');
    expect(
      lastErrorFromState({
        type: 'stopping',
        generation: 1,
        outcome: 'idle',
      }),
    ).toBeNull();
  });

  it('treats only in-flight operations as busy and targets the destination id', () => {
    expect(isConnectionStateInFlight({ type: 'disconnected' })).toBe(false);
    expect(
      isConnectionStateInFlight({
        type: 'connected',
        serverId: 'a',
        mode: 'proxy',
      }),
    ).toBe(false);
    expect(
      isConnectionStateInFlight({
        type: 'starting',
        serverId: 'a',
        mode: 'proxy',
        generation: 1,
      }),
    ).toBe(true);
    expect(
      activeServerIdFromState({
        type: 'switching',
        from: 'a',
        to: 'b',
        mode: 'proxy',
        generation: 1,
      }),
    ).toBe('b');
  });
});

describe('health policy', () => {
  const policy = createAutoSwitchPolicy();

  it('ignores non-blocking probe noise', () => {
    const server = makeServer({ uuid: 'a' });
    expect(
      policy.onHealthFailure({
        server,
        reason: 'slow',
        blocking: false,
        autoSwitchEnabled: true,
        servers: [server, makeServer({ uuid: 'b' })],
        blockedServerIds: new Set(),
      }),
    ).toEqual({ action: 'none' });
  });

  it('disconnects when auto-switch is disabled or every alternative is blocked', () => {
    const current = makeServer({ uuid: 'a' });
    const other = makeServer({ uuid: 'b' });
    expect(
      policy.onHealthFailure({
        server: current,
        reason: 'blocked',
        blocking: true,
        autoSwitchEnabled: false,
        servers: [current, other],
        blockedServerIds: new Set(),
      }),
    ).toEqual({ action: 'disconnect' });
    expect(
      policy.onHealthFailure({
        server: current,
        reason: 'blocked',
        blocking: true,
        autoSwitchEnabled: true,
        servers: [current, other],
        blockedServerIds: new Set(['a', 'b']),
      }),
    ).toEqual({ action: 'disconnect' });
  });

  it('switches to ranked candidates when auto-switch is enabled', () => {
    const current = makeServer({ uuid: 'a', ping: 200 });
    const next = makeServer({ uuid: 'b', ping: 20 });
    expect(
      policy.onHealthFailure({
        server: current,
        reason: 'blocked',
        blocking: true,
        autoSwitchEnabled: true,
        servers: [current, next],
        blockedServerIds: new Set(),
      }),
    ).toEqual({ action: 'switch', candidates: [next] });
  });

  it('session owns the blocked ledger and auto-switch toggle', () => {
    const ledger = new SessionPolicyState();
    ledger.setAutoSwitchingEnabled(false);
    ledger.markBlocked('server-1', 1_000);
    expect(ledger.getAutoSwitchingEnabled()).toBe(false);
    expect(ledger.getBlockedServerIds(1_000)).toEqual(['server-1']);
    expect(ledger.getBlockedServerIds(1_000 + 10 * 60 * 1000)).toEqual([]);
    ledger.clearBlocked();
    expect(ledger.getBlockedServerIds(1_000)).toEqual([]);
  });
});
