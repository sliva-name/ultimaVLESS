import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerPingHandlers } from './pingHandlers';
import { IPC_EVENT_CHANNELS, IPC_INVOKE_CHANNELS } from '@/shared/ipc';
import { makeMonitorStatus, makeServer } from '@/test/factories';

const ipcHandleMock = vi.hoisted(() => vi.fn());

vi.mock('electron', () => ({
  ipcMain: {
    handle: ipcHandleMock,
  },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('registerPingHandlers', () => {
  const handlers = new Map<
    string,
    (event: unknown, payload?: unknown) => Promise<unknown>
  >();

  beforeEach(() => {
    handlers.clear();
    ipcHandleMock.mockReset();
    ipcHandleMock.mockImplementation(
      (
        channel: string,
        handler: (event: unknown, payload?: unknown) => Promise<unknown>,
      ) => {
        handlers.set(channel, handler);
      },
    );
  });

  it('drops ping-all results if connection starts before writeback', async () => {
    const pingResults = deferred<Map<string, number | null>>();
    const server = makeServer({
      uuid: 'server-1',
      address: 'example.com',
      ping: 42,
      pingTime: 1000,
      pingStale: false,
    });
    let busy = false;
    const setServers = vi.fn();

    registerPingHandlers({
      deps: {
        configService: {
          getServers: vi.fn(() => [server]),
          setServers,
        },
        connectionMonitorService: {
          getStatus: vi.fn(() => makeMonitorStatus()),
        },
        xrayService: {
          isRunning: vi.fn(() => false),
        },
        pingService: {
          pingServers: vi.fn(() => pingResults.promise),
          pingServer: vi.fn(),
        },
      } as never,
      sendToRenderer: vi.fn(),
      assertTrustedSender: vi.fn(),
      isConnectionBusy: () => busy,
    });

    const handler = handlers.get(IPC_INVOKE_CHANNELS.pingAllServers);
    expect(handler).toBeTypeOf('function');

    const resultPromise = handler!({} as never, true);
    await Promise.resolve();
    busy = true;
    pingResults.resolve(new Map([[server.uuid, 12]]));

    await expect(resultPromise).resolves.toEqual([
      { uuid: server.uuid, latency: 42 },
    ]);
    expect(setServers).not.toHaveBeenCalled();
  });

  it('emits ping patches instead of broadcasting the full server list', async () => {
    const server = makeServer({
      uuid: 'server-1',
      address: 'example.com',
      ping: null,
    });
    const setServerPingPatches = vi.fn(() => [
      { ...server, ping: 24, pingTime: 1000, pingStale: false },
    ]);
    const sendToRenderer = vi.fn();

    registerPingHandlers({
      deps: {
        configService: {
          getServers: vi.fn(() => [server]),
          setServers: vi.fn(),
          setServerPingPatches,
        },
        connectionMonitorService: {
          getStatus: vi.fn(() => makeMonitorStatus()),
        },
        xrayService: {
          isRunning: vi.fn(() => false),
        },
        pingService: {
          pingServers: vi.fn(async () => new Map([[server.uuid, 24]])),
          pingServer: vi.fn(),
        },
      } as never,
      sendToRenderer,
      assertTrustedSender: vi.fn(),
      isConnectionBusy: () => false,
    });

    const handler = handlers.get(IPC_INVOKE_CHANNELS.pingAllServers);
    await handler!({} as never, true);

    expect(setServerPingPatches).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          uuid: server.uuid,
          ping: 24,
          pingStale: false,
        }),
      ],
      { debounce: true },
    );
    expect(sendToRenderer).toHaveBeenCalledWith(
      IPC_EVENT_CHANNELS.updateServerPings,
      [
        expect.objectContaining({
          uuid: server.uuid,
          ping: 24,
          pingStale: false,
        }),
      ],
    );
    expect(sendToRenderer).not.toHaveBeenCalledWith(
      IPC_EVENT_CHANNELS.updateServers,
      expect.anything(),
    );
  });
});
