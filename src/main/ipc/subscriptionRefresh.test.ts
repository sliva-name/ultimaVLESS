import { describe, expect, it, vi } from 'vitest';
import { createSubscriptionRefreshManager } from './subscriptionRefresh';
import { makeServer, makeSubscription } from '@/test/factories';

function createManager(overrides: Partial<any> = {}) {
  const server = makeServer({ uuid: 'server-1' });
  const deps = {
    getWindow: vi.fn(() => null),
    configService: {
      getSelectedServerId: vi.fn(() => null),
      setSelectedServerId: vi.fn(),
    },
    subscriptionRepository: {
      list: vi.fn(() => [makeSubscription()]),
      getManualLinks: vi.fn(() => ''),
    },
    serverRepository: {
      list: vi.fn(() => []),
      saveAll: vi.fn(),
    },
    subscriptionService: {
      fetchAndParseDetailed: vi.fn(async () => ({ configs: [server] })),
      parseDirectLinksFromText: vi.fn(() => []),
    },
    connectionController: {
      getConnectionState: vi.fn(() => ({ type: 'disconnected' })),
      reconcileActiveServer: vi.fn(() => null),
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
    expect(deps.serverRepository.saveAll).toHaveBeenCalledWith([
      expect.objectContaining({ uuid: 'server-1', ping: null }),
    ]);
    expect(deps.notifyStateChanged).toHaveBeenCalledTimes(1);
  });

  it('drops configs of subscriptions disabled while the refresh was in flight', async () => {
    const subscription = makeSubscription();
    let fetchStarted = false;
    const { deps, manager } = createManager({
      subscriptionRepository: {
        // Enabled when the refresh starts, disabled by the time it finishes.
        list: vi.fn(() =>
          fetchStarted
            ? [{ ...subscription, enabled: false }]
            : [subscription],
        ),
        getManualLinks: vi.fn(() => ''),
      },
      serverRepository: {
        list: vi.fn(() => []),
        saveAll: vi.fn(),
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
    expect(deps.serverRepository.saveAll).not.toHaveBeenCalled();
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

  it('preserves a live session server omitted by refresh', async () => {
    const live = makeServer({ uuid: 'live', address: '9.9.9.9', name: 'Live' });
    const next = makeServer({ uuid: 'new', address: '1.2.3.4', name: 'New' });
    const { deps, manager } = createManager({
      serverRepository: {
        list: vi.fn(() => [live]),
        saveAll: vi.fn(),
      },
      subscriptionService: {
        fetchAndParseDetailed: vi.fn(async () => ({ configs: [next] })),
        parseDirectLinksFromText: vi.fn(() => []),
      },
      connectionController: {
        getConnectionState: vi.fn(() => ({
          type: 'connected',
          serverId: 'live',
          mode: 'proxy',
        })),
        reconcileActiveServer: vi.fn(() => 'live'),
      },
    });

    await manager.queueRefreshAllSubscriptions('');

    expect(deps.serverRepository.saveAll).toHaveBeenCalledWith([
      expect.objectContaining({ uuid: 'live' }),
      expect.objectContaining({ uuid: 'new' }),
    ]);
    expect(deps.configService.setSelectedServerId).toHaveBeenCalledWith('live');
  });

  it('reapplies ping by endpoint identity after uuid rotation', async () => {
    const previous = makeServer({
      uuid: 'old-id',
      address: '1.2.3.4',
      ping: 42,
      pingTime: 100,
    });
    const rotated = makeServer({ uuid: 'new-id', address: '1.2.3.4' });
    const { deps, manager } = createManager({
      serverRepository: {
        list: vi.fn(() => [previous]),
        saveAll: vi.fn(),
      },
      subscriptionService: {
        fetchAndParseDetailed: vi.fn(async () => ({ configs: [rotated] })),
        parseDirectLinksFromText: vi.fn(() => []),
      },
      connectionController: {
        getConnectionState: vi.fn(() => ({
          type: 'connected',
          serverId: 'old-id',
          mode: 'proxy',
        })),
        reconcileActiveServer: vi.fn(() => 'new-id'),
      },
    });

    await manager.queueRefreshAllSubscriptions('');

    expect(deps.connectionController.reconcileActiveServer).toHaveBeenCalled();
    expect(deps.configService.setSelectedServerId).toHaveBeenCalledWith(
      'new-id',
    );
    expect(deps.serverRepository.saveAll).toHaveBeenCalledWith([
      expect.objectContaining({ uuid: 'new-id', ping: 42, pingStale: true }),
    ]);
  });
});
