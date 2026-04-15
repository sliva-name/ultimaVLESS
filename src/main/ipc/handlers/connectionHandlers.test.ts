import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerConnectionHandlers } from './connectionHandlers';
import { IPC_INVOKE_CHANNELS } from '../../../shared/ipc';

const ipcHandleMock = vi.hoisted(() => vi.fn());

vi.mock('electron', () => ({
  ipcMain: {
    handle: ipcHandleMock,
  },
}));

vi.mock('../../services/LoggerService', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

describe('registerConnectionHandlers', () => {
  const handlers = new Map<string, (event: unknown, payload?: unknown) => Promise<unknown>>();

  beforeEach(() => {
    handlers.clear();
    ipcHandleMock.mockReset();
    ipcHandleMock.mockImplementation((channel: string, handler: (event: unknown, payload?: unknown) => Promise<unknown>) => {
      handlers.set(channel, handler);
    });
  });

  function registerWith(overrides: Partial<any> = {}) {
    const deps = {
      configService: {
        getServers: vi.fn(() => []),
        getConnectionMode: vi.fn(() => 'proxy'),
        clearPendingTunReconnect: vi.fn(),
        setSelectedServerId: vi.fn(),
      },
      connectionMonitorService: {
        getStatus: vi.fn(() => ({ isConnected: false, currentServer: null })),
        stopMonitoring: vi.fn(),
        startMonitoring: vi.fn(),
        recordError: vi.fn(),
      },
      connectionStackService: {
        transitionTo: vi.fn(),
        resetNetworkingStack: vi.fn(async () => undefined),
        cleanupAfterFailure: vi.fn(),
      },
      xrayService: {
        isRunning: vi.fn(() => false),
      },
      tunRouteService: {
        isSupported: vi.fn(() => true),
        getUnsupportedReason: vi.fn(() => null),
      },
      hasTunPrivileges: vi.fn(async () => true),
      requestTunPrivilegesRelaunch: vi.fn(async () => false),
      app: {
        releaseSingleInstanceLock: vi.fn(),
        quit: vi.fn(),
      },
      constants: {
        ports: { http: 10809, socks: 10808 },
      },
      ...overrides,
    };

    registerConnectionHandlers({
      deps,
      assertTrustedSender: vi.fn(),
      sendToRenderer: vi.fn(),
      beginConnectionBusy: vi.fn(),
      endConnectionBusy: vi.fn(),
    });

    const disconnectHandler = handlers.get(IPC_INVOKE_CHANNELS.disconnect);
    expect(disconnectHandler).toBeTypeOf('function');

    return { deps, disconnectHandler: disconnectHandler! };
  }

  it('stops monitoring only after the networking stack resets successfully', async () => {
    const { deps, disconnectHandler } = registerWith();

    const result = await disconnectHandler({} as never);

    expect(result).toEqual({ ok: true });
    expect(deps.connectionStackService.resetNetworkingStack).toHaveBeenCalledWith({ stopXray: true });
    expect(deps.connectionMonitorService.stopMonitoring).toHaveBeenCalledWith({ message: 'Disconnected' });
    expect(
      deps.connectionStackService.resetNetworkingStack.mock.invocationCallOrder[0]
    ).toBeLessThan(deps.connectionMonitorService.stopMonitoring.mock.invocationCallOrder[0]);
  });

  it('keeps monitoring active when stack reset fails during disconnect', async () => {
    const resetError = new Error('disable failed');
    const { deps, disconnectHandler } = registerWith({
      connectionStackService: {
        transitionTo: vi.fn(),
        resetNetworkingStack: vi.fn(async () => {
          throw resetError;
        }),
        cleanupAfterFailure: vi.fn(),
      },
    });

    const result = await disconnectHandler({} as never);

    expect(result).toEqual({ ok: false });
    expect(deps.connectionMonitorService.stopMonitoring).not.toHaveBeenCalled();
  });
});
