import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  loadInitialState,
  STARTUP_PING_MAX_WAIT_MS,
} from '@/main/ipc/initialState';
import { makeSubscription } from '@/test/factories';

function createHarness(
  options: {
    pendingTunReconnect?: boolean;
    subscriptions?: ReturnType<typeof makeSubscription>[];
    relaunchedElevated?: boolean;
    refreshResult?: { configCount: number; reason?: string };
  } = {},
) {
  const calls: string[] = [];
  let resolveRefresh: (value: {
    configCount: number;
    reason?: string;
  }) => void = () => undefined;
  const actions = {
    notifySnapshot: vi.fn(),
    queueRefreshAllSubscriptions: vi.fn(() => {
      calls.push('refresh');
      return new Promise<{ configCount: number; reason?: string }>(
        (resolve) => {
          resolveRefresh = resolve;
        },
      );
    }),
    reportSubscriptionRefreshIssue: vi.fn(),
    restartAutoRefreshTimer: vi.fn(),
    attemptPendingTunReconnect: vi.fn(async () => {
      calls.push('reconnect');
      return true;
    }),
    requestPingRefresh: vi.fn(() => {
      calls.push('ping');
    }),
  };
  const deps = {
    configService: {
      peekPendingTunReconnect: vi.fn(() =>
        options.pendingTunReconnect ? 'server-1' : null,
      ),
    },
    subscriptionRepository: {
      list: vi.fn(() => options.subscriptions ?? [makeSubscription()]),
      getManualLinks: vi.fn(() => ''),
    },
    stopAutoRefreshTimer: vi.fn(),
    relaunchedElevated: options.relaunchedElevated ?? false,
  };
  return {
    actions,
    deps,
    calls,
    finishRefresh: (value = options.refreshResult ?? { configCount: 3 }) =>
      resolveRefresh(value),
  };
}

describe('loadInitialState', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resumes the pending TUN session immediately instead of after the network refresh', async () => {
    const { actions, deps, calls } = createHarness({
      pendingTunReconnect: true,
    });

    await loadInitialState({} as any, actions, deps as any);

    // The reconnect is kicked off synchronously; the refresh is still deferred.
    expect(calls).toEqual(['reconnect']);
    expect(actions.queueRefreshAllSubscriptions).not.toHaveBeenCalled();
    expect(actions.notifySnapshot).toHaveBeenCalledWith('bootstrap');
    expect(actions.restartAutoRefreshTimer).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(800);
    expect(calls).toEqual(['reconnect', 'refresh']);
  });

  it('reports an empty refresh result without touching the reconnect path', async () => {
    const { actions, deps, finishRefresh } = createHarness({
      refreshResult: { configCount: 0, reason: 'offline' },
    });

    await loadInitialState({} as any, actions, deps as any);
    await vi.advanceTimersByTimeAsync(800);
    finishRefresh();
    await vi.advanceTimersByTimeAsync(0);

    expect(actions.reportSubscriptionRefreshIssue).toHaveBeenCalledWith(
      'offline',
    );
    // Always invoked once: a no-op without a pending record.
    expect(actions.attemptPendingTunReconnect).toHaveBeenCalledTimes(1);
  });

  it('skips the refresh and stops the timer when there is no subscription input', async () => {
    const { actions, deps } = createHarness({
      subscriptions: [makeSubscription({ enabled: false })],
    });

    await loadInitialState({} as any, actions, deps as any);
    await vi.advanceTimersByTimeAsync(1000);

    expect(actions.queueRefreshAllSubscriptions).not.toHaveBeenCalled();
    expect(deps.stopAutoRefreshTimer).toHaveBeenCalledTimes(1);
    expect(actions.attemptPendingTunReconnect).toHaveBeenCalledTimes(1);
  });

  it('does not let a failing reconnect break the load', async () => {
    const { actions, deps } = createHarness({ pendingTunReconnect: true });
    actions.attemptPendingTunReconnect.mockRejectedValue(
      new Error('no privileges'),
    );

    await expect(
      loadInitialState({} as any, actions, deps as any),
    ).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(0);
  });

  describe('startup ping', () => {
    it('measures the catalog once the initial refresh has settled', async () => {
      const { actions, deps, calls, finishRefresh } = createHarness();

      await loadInitialState({} as any, actions, deps as any);
      await vi.advanceTimersByTimeAsync(800);
      expect(actions.requestPingRefresh).not.toHaveBeenCalled();

      finishRefresh();
      await vi.advanceTimersByTimeAsync(0);

      expect(actions.requestPingRefresh).toHaveBeenCalledWith('startup');
      expect(calls).toEqual(['reconnect', 'refresh', 'ping']);

      // The cap must not request a second pass later.
      await vi.advanceTimersByTimeAsync(STARTUP_PING_MAX_WAIT_MS);
      expect(actions.requestPingRefresh).toHaveBeenCalledTimes(1);
    });

    it('still measures when the refresh fails', async () => {
      const { actions, deps } = createHarness();
      actions.queueRefreshAllSubscriptions.mockRejectedValue(
        new Error('offline'),
      );

      await loadInitialState({} as any, actions, deps as any);
      await vi.advanceTimersByTimeAsync(800);

      expect(actions.reportSubscriptionRefreshIssue).toHaveBeenCalledWith(
        'offline',
      );
      expect(actions.requestPingRefresh).toHaveBeenCalledWith('startup');
    });

    it('does not wait forever for a hung refresh', async () => {
      const { actions, deps, finishRefresh } = createHarness();

      await loadInitialState({} as any, actions, deps as any);
      await vi.advanceTimersByTimeAsync(STARTUP_PING_MAX_WAIT_MS - 1);
      expect(actions.requestPingRefresh).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      expect(actions.requestPingRefresh).toHaveBeenCalledTimes(1);

      // Late settle: the catalog-changed hook handles new rows, not this path.
      finishRefresh();
      await vi.advanceTimersByTimeAsync(0);
      expect(actions.requestPingRefresh).toHaveBeenCalledTimes(1);
    });

    it('measures shortly after load when there is nothing to refresh', async () => {
      const { actions, deps } = createHarness({
        subscriptions: [makeSubscription({ enabled: false })],
      });

      await loadInitialState({} as any, actions, deps as any);
      expect(actions.requestPingRefresh).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(800);
      expect(actions.requestPingRefresh).toHaveBeenCalledWith('startup');
    });

    it('leaves a resumed TUN session alone', async () => {
      const { actions, deps, finishRefresh } = createHarness({
        pendingTunReconnect: true,
      });

      await loadInitialState({} as any, actions, deps as any);
      await vi.advanceTimersByTimeAsync(800);
      finishRefresh();
      await vi.advanceTimersByTimeAsync(STARTUP_PING_MAX_WAIT_MS);

      expect(actions.requestPingRefresh).not.toHaveBeenCalled();
    });
  });
});
