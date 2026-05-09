import { describe, expect, it, vi } from 'vitest';
import { loadInitialState } from './initialState';
import { makeMonitorStatus, makeServer } from '@/test/factories';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flushAsyncWork = () =>
  new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('loadInitialState', () => {
  it('waits for startup refresh before pending TUN reconnect', async () => {
    const refresh = deferred<{ configCount: number }>();
    const selectedServer = makeServer({ uuid: 'new-server' });
    const configService = {
      getSubscriptions: vi.fn(() => [
        {
          id: 'sub-1',
          name: 'Subscription',
          url: 'https://example.com/sub',
          enabled: true,
        },
      ]),
      getManualLinksInput: vi.fn(() => ''),
      consumePendingTunReconnect: vi.fn(() => 'old-server'),
      getServers: vi.fn(() => [selectedServer]),
      getSelectedServerId: vi.fn(() => 'new-server'),
    };
    const attemptPendingTunReconnect = vi.fn(async () => true);

    await loadInitialState(
      {} as never,
      {
        sendToRenderer: vi.fn(),
        queueRefreshAllSubscriptions: vi.fn(() => refresh.promise),
        reportSubscriptionRefreshIssue: vi.fn(),
        restartAutoRefreshTimer: vi.fn(),
        attemptPendingTunReconnect,
      },
      {
        configService: configService as never,
        connectionMonitorService: {
          getStatus: vi.fn(() => makeMonitorStatus()),
        } as never,
        xrayService: {
          isRunning: vi.fn(() => false),
        } as never,
        createRuntimeDependencies: vi.fn(() => ({}) as never),
        stopAutoRefreshTimer: vi.fn(),
      },
    );

    expect(attemptPendingTunReconnect).not.toHaveBeenCalled();

    refresh.resolve({ configCount: 1 });
    await refresh.promise;
    await flushAsyncWork();

    expect(attemptPendingTunReconnect).toHaveBeenCalledWith(
      'new-server',
      expect.anything(),
      { emitErrorOnFailure: true },
    );
  });
});
