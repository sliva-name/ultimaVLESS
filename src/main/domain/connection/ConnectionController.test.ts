import { describe, expect, it, vi } from 'vitest';
import { makeServer } from '@/test/factories';
import { ConnectionController } from './ConnectionController';
import type { ConnectionMode } from '@/shared/types';

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
  });

  it('records pending TUN reconnect before administrator relaunch', async () => {
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

    await expect(controller.connect(server.uuid)).rejects.toMatchObject({
      relaunched: true,
    });
    expect(deps.configService.setPendingTunReconnect).toHaveBeenCalledWith(
      server.uuid,
    );
    expect(deps.app.quit).toHaveBeenCalledTimes(1);
  });
});
