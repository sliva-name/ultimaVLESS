import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC_INVOKE_CHANNELS } from '@/shared/ipc';
import { registerConnectionHandlers } from './connectionHandlers';

const ipcHandleMock = vi.hoisted(() => vi.fn());

vi.mock('electron', () => ({
  ipcMain: {
    handle: ipcHandleMock,
  },
}));

vi.mock('@/main/services/LoggerService', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/main/services/ConnectionController', () => ({
  ConnectionControllerRelaunchError: class ConnectionControllerRelaunchError extends Error {
    public readonly relaunched = true;
  },
}));

describe('connection IPC handlers', () => {
  const handlers = new Map<string, (event: unknown, payload?: unknown) => any>();

  beforeEach(() => {
    handlers.clear();
    ipcHandleMock.mockReset();
    ipcHandleMock.mockImplementation((channel: string, handler) => {
      handlers.set(channel, handler);
    });
  });

  function registerWith(overrides: Partial<any> = {}) {
    const deps = {
      connectionController: {
        connect: vi.fn(async () => undefined),
        disconnect: vi.fn(async () => undefined),
        cleanupAfterFailure: vi.fn(async () => undefined),
      },
      connectionMonitorService: {
        recordError: vi.fn(),
      },
      ...overrides,
    };
    registerConnectionHandlers({
      deps: deps as any,
      assertTrustedSender: vi.fn(),
    });
    return deps;
  }

  it('connects by server id only', async () => {
    const deps = registerWith();
    const handler = handlers.get(IPC_INVOKE_CHANNELS.connect)!;

    await expect(handler({} as never, 'server-1')).resolves.toEqual({
      ok: true,
    });
    expect(deps.connectionController.connect).toHaveBeenCalledWith('server-1');
  });

  it('cleans up and returns a structured error when connect fails', async () => {
    const deps = registerWith({
      connectionController: {
        connect: vi.fn(async () => {
          throw new Error('boom');
        }),
        disconnect: vi.fn(),
        cleanupAfterFailure: vi.fn(async () => undefined),
      },
    });
    const handler = handlers.get(IPC_INVOKE_CHANNELS.connect)!;

    await expect(handler({} as never, 'server-1')).resolves.toEqual({
      ok: false,
      error: 'boom',
    });
    expect(deps.connectionMonitorService.recordError).toHaveBeenCalledWith(
      'boom',
    );
    expect(deps.connectionController.cleanupAfterFailure).toHaveBeenCalled();
  });
});
