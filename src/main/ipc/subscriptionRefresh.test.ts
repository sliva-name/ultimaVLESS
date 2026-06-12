import { describe, expect, it, vi } from 'vitest';
import { createSubscriptionRefreshManager } from './subscriptionRefresh';
import { makeServer, makeSubscription } from '@/test/factories';

function createManager(overrides: Partial<any> = {}) {
  const server = makeServer({ uuid: 'server-1' });
  const deps = {
    getWindow: vi.fn(() => null),
    configService: {
      getSubscriptions: vi.fn(() => [makeSubscription()]),
      getManualLinksInput: vi.fn(() => ''),
      getServers: vi.fn(() => []),
      setServers: vi.fn(),
      getSelectedServerId: vi.fn(() => null),
      setSelectedServerId: vi.fn(),
    },
    subscriptionService: {
      fetchAndParseDetailed: vi.fn(async () => ({ configs: [server] })),
      parseDirectLinksFromText: vi.fn(() => []),
    },
    connectionMonitorService: {
      getStatus: vi.fn(() => ({ isConnected: false, currentServer: null })),
      syncCurrentServer: vi.fn(() => null),
    },
    xrayService: {
      isRunning: vi.fn(() => false),
    },
    notifyStateChanged: vi.fn(),
    ...overrides,
  };
  return { deps, manager: createSubscriptionRefreshManager(deps) };
}

describe('SubscriptionRefreshManager', () => {
  it('persists refreshed servers and notifies the snapshot publisher', async () => {
    const { deps, manager } = createManager();

    const result = await manager.queueRefreshAllSubscriptions('');

    expect(result.configCount).toBe(1);
    expect(deps.configService.setServers).toHaveBeenCalledWith([
      expect.objectContaining({ uuid: 'server-1', ping: null }),
    ]);
    expect(deps.notifyStateChanged).toHaveBeenCalledTimes(1);
  });

  it('drops configs of subscriptions disabled while the refresh was in flight', async () => {
    const subscription = makeSubscription();
    let fetchStarted = false;
    const { deps, manager } = createManager({
      configService: {
        // Enabled when the refresh starts, disabled by the time it finishes.
        getSubscriptions: vi.fn(() =>
          fetchStarted
            ? [{ ...subscription, enabled: false }]
            : [subscription],
        ),
        getManualLinksInput: vi.fn(() => ''),
        getServers: vi.fn(() => []),
        setServers: vi.fn(),
        getSelectedServerId: vi.fn(() => null),
        setSelectedServerId: vi.fn(),
      },
      subscriptionService: {
        fetchAndParseDetailed: vi.fn(async () => {
          fetchStarted = true;
          return { configs: [makeServer({ uuid: 'server-1' })] };
        }),
        parseDirectLinksFromText: vi.fn(() => []),
      },
    });

    const result = await manager.queueRefreshAllSubscriptions('');

    expect(result.configCount).toBe(0);
    expect(deps.configService.setServers).not.toHaveBeenCalled();
  });

  it('does not send renderer events directly when refresh fails', async () => {
    const { deps, manager } = createManager({
      subscriptionService: {
        fetchAndParseDetailed: vi.fn(async () => {
          throw new Error('offline');
        }),
        parseDirectLinksFromText: vi.fn(() => []),
      },
    });

    await expect(manager.queueRefreshAllSubscriptions('')).resolves.toMatchObject(
      { configCount: 0 },
    );
    manager.reportSubscriptionRefreshIssue('offline');

    expect(deps.getWindow).not.toHaveBeenCalled();
    expect(deps.notifyStateChanged).toHaveBeenCalledTimes(1);
  });
});
