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
  const apply = vi.fn(async () => undefined);
  const reset = vi.fn(async () => undefined);
  const deps = {
    app: {
      releaseSingleInstanceLock: vi.fn(),
      quit: vi.fn(),
    },
    constants: { ports: { http: 10809, socks: 10808 } },
    configService: {
      getServers: vi.fn(() => [server]),
      getConnectionMode: vi.fn((): ConnectionMode => 'proxy'),
      setSelectedServerId: vi.fn(),
      setPendingTunReconnect: vi.fn(),
      clearPendingTunReconnect: vi.fn(),
    },
    connectionMonitorService: {
      getStatus: vi.fn(() => ({ isConnected: false, currentServer: null })),
      startMonitoring: vi.fn(),
      stopMonitoring: vi.fn(),
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
    strategies: {
      proxy: { mode: 'proxy', apply },
      tun: { mode: 'tun', apply },
    },
    teardown: { reset },
    ...overrides,
  };

  return {
    controller: new ConnectionController(deps as any),
    deps,
    server,
    apply,
    reset,
  };
}

describe('ConnectionController', () => {
  it('connects through the selected strategy and starts monitoring', async () => {
    const { controller, deps, server, apply, reset } = createController();

    await controller.connect(server.uuid);

    expect(reset).toHaveBeenCalledWith({ stopXray: true });
    expect(apply).toHaveBeenCalledWith(server, { http: 10809, socks: 10808 });
    expect(deps.configService.setSelectedServerId).toHaveBeenCalledWith(
      server.uuid,
    );
    expect(deps.connectionMonitorService.startMonitoring).toHaveBeenCalledWith(
      server,
    );
    expect(controller.isBusy()).toBe(false);
    expect(controller.getPhase()).toBe('connected');
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
    const { controller, reset } = createController();
    const phases: SessionPhase[] = [];
    controller.on('phase-changed', (phase: SessionPhase) => {
      phases.push(phase);
    });

    await controller.connect(makeServer({ uuid: 'server-1' }).uuid);
    phases.length = 0;
    await controller.cleanupAfterFailure();

    expect(reset).toHaveBeenCalled();
    expect(phases).toEqual(['disconnecting', 'idle']);
    expect(controller.getPhase()).toBe('idle');
  });

  it('uses the platform-specific privilege path for TUN connections', async () => {
    const { controller, deps, server } = createController({
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
});
