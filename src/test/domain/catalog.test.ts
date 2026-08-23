import { describe, expect, it, vi } from 'vitest';
import { createSubscriptionRefreshManager } from '@/main/ipc/subscriptionRefresh';
import { preserveActiveServerIfNeeded } from '@/main/ipc/refreshUtils';
import { applyPingOverlay, collectPingOverlay } from '@/shared/pingOverlay';
import { makeServer, makeSubscription } from '@/test/factories';

function createRefresh(overrides: Partial<any> = {}) {
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
    connectionManager: {
      getConnectionState: vi.fn(() => ({ type: 'disconnected' })),
      reconcileActiveServer: vi.fn(() => null),
    },
    notifyStateChanged: vi.fn(),
    ...overrides,
  };
  return { deps, manager: createSubscriptionRefreshManager(deps) };
}

describe('catalog refresh', () => {
  it('persists refreshed servers without catalog pings', async () => {
    const { deps, manager } = createRefresh();

    const result = await manager.queueRefreshAllSubscriptions('');

    expect(result.configCount).toBe(1);
    expect(deps.serverRepository.saveAll).toHaveBeenCalledWith([
      expect.objectContaining({ uuid: 'server-1', ping: null }),
    ]);
    expect(deps.notifyStateChanged).toHaveBeenCalledTimes(1);
  });

  it('drops configs of a subscription disabled while refresh was in flight', async () => {
    const subscription = makeSubscription();
    let fetchStarted = false;
    const { deps, manager } = createRefresh({
      subscriptionRepository: {
        list: vi.fn(() =>
          fetchStarted ? [{ ...subscription, enabled: false }] : [subscription],
        ),
        getManualLinks: vi.fn(() => ''),
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

  it('does not talk to the renderer window when refresh fails', async () => {
    const { deps, manager } = createRefresh({
      subscriptionService: {
        fetchAndParseDetailed: vi.fn(async () => {
          throw new Error('offline');
        }),
        parseDirectLinksFromText: vi.fn(() => []),
      },
    });

    await expect(
      manager.queueRefreshAllSubscriptions(''),
    ).resolves.toMatchObject({ configCount: 0 });
    manager.reportSubscriptionRefreshIssue('offline');

    expect(deps.getWindow).not.toHaveBeenCalled();
    expect(deps.notifyStateChanged).toHaveBeenCalledTimes(1);
  });

  it('keeps a live session server omitted by refresh', async () => {
    const live = makeServer({ uuid: 'live', address: '9.9.9.9', name: 'Live' });
    const next = makeServer({ uuid: 'new', address: '1.2.3.4', name: 'New' });
    const { deps, manager } = createRefresh({
      serverRepository: {
        list: vi.fn(() => [live]),
        saveAll: vi.fn(),
      },
      subscriptionService: {
        fetchAndParseDetailed: vi.fn(async () => ({ configs: [next] })),
        parseDirectLinksFromText: vi.fn(() => []),
      },
      connectionManager: {
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

  it('reapplies ping by fingerprint after uuid rotation and remaps the live session', async () => {
    const previous = makeServer({
      uuid: 'old-id',
      name: 'Frankfurt',
      address: '1.2.3.4',
      ping: 42,
      pingTime: 100,
    });
    const rotated = makeServer({
      uuid: 'new-id',
      name: 'Frankfurt',
      address: '1.2.3.4',
    });
    const { deps, manager } = createRefresh({
      serverRepository: {
        list: vi.fn(() => [previous]),
        saveAll: vi.fn(),
      },
      subscriptionService: {
        fetchAndParseDetailed: vi.fn(async () => ({ configs: [rotated] })),
        parseDirectLinksFromText: vi.fn(() => []),
      },
      connectionManager: {
        getConnectionState: vi.fn(() => ({
          type: 'connected',
          serverId: 'old-id',
          mode: 'proxy',
        })),
        reconcileActiveServer: vi.fn(() => 'new-id'),
      },
    });

    await manager.queueRefreshAllSubscriptions('');

    expect(deps.connectionManager.reconcileActiveServer).toHaveBeenCalled();
    expect(deps.configService.setSelectedServerId).toHaveBeenCalledWith(
      'new-id',
    );
    expect(deps.serverRepository.saveAll).toHaveBeenCalledWith([
      expect.objectContaining({ uuid: 'new-id', ping: 42, pingStale: true }),
    ]);
  });
});

describe('preserve live/selected catalog identity', () => {
  it('keeps the live session server when refresh omits it', () => {
    const live = makeServer({ uuid: 'live', name: 'Live', address: '9.9.9.9' });
    const next = makeServer({ uuid: 'new', name: 'New', address: '1.2.3.4' });

    expect(
      preserveActiveServerIfNeeded([next], [live, next], 'live').map(
        (server) => server.uuid,
      ),
    ).toEqual(['live', 'new']);
  });

  it('does not invent a live server from empty session state', () => {
    const next = makeServer({ uuid: 'new' });
    expect(preserveActiveServerIfNeeded([next], [next], null)).toEqual([next]);
  });

  it('keeps an unmatched selected server', () => {
    const selected = makeServer({ uuid: 'picked', address: '9.9.9.9' });
    const next = makeServer({ uuid: 'new', address: '1.2.3.4' });

    expect(
      preserveActiveServerIfNeeded([next], [selected], null, 'picked').map(
        (server) => server.uuid,
      ),
    ).toEqual(['picked', 'new']);
  });

  it('does not duplicate a live server already represented by fingerprint', () => {
    const live = makeServer({
      uuid: 'old-id',
      name: 'Frankfurt',
      address: '1.2.3.4',
    });
    const rotated = makeServer({
      uuid: 'new-id',
      name: 'Frankfurt',
      address: '1.2.3.4',
    });

    expect(
      preserveActiveServerIfNeeded([rotated], [live], 'old-id').map(
        (server) => server.uuid,
      ),
    ).toEqual(['new-id']);
  });

  it('does not treat a CDN sibling as the same live catalog row', () => {
    const live = makeServer({
      uuid: 'old-id',
      address: '1.2.3.4',
      sni: 'a.example',
    });
    const sibling = makeServer({
      uuid: 'new-id',
      address: '1.2.3.4',
      sni: 'b.example',
    });

    expect(
      preserveActiveServerIfNeeded([sibling], [live], 'old-id').map(
        (server) => server.uuid,
      ),
    ).toEqual(['old-id', 'new-id']);
  });
});

describe('ping overlay', () => {
  it('reapplies ping by uuid, then by fingerprint after uuid rotation', () => {
    const stored = [
      makeServer({
        uuid: 'old-id',
        name: 'Frankfurt',
        address: '1.2.3.4',
        sni: 'a.example',
        ping: 18,
        pingTime: 50,
      }),
    ];
    const refreshed = [
      makeServer({
        uuid: 'new-id',
        name: 'Frankfurt',
        address: '1.2.3.4',
        sni: 'a.example',
      }),
      makeServer({ uuid: 'other', address: '8.8.8.8' }),
    ];

    const merged = applyPingOverlay(refreshed, collectPingOverlay(stored));

    expect(merged[0]).toMatchObject({
      uuid: 'new-id',
      ping: 18,
      pingStale: true,
    });
    expect(merged[1]).toMatchObject({
      uuid: 'other',
      ping: null,
      pingStale: false,
    });
  });

  it('does not copy ping between nodes that only share host:port', () => {
    const stored = [
      makeServer({
        uuid: 'cdn-a',
        address: '1.2.3.4',
        sni: 'a.example',
        ping: 18,
        pingTime: 50,
      }),
    ];
    const refreshed = [
      makeServer({ uuid: 'cdn-b', address: '1.2.3.4', sni: 'b.example' }),
    ];

    const merged = applyPingOverlay(refreshed, collectPingOverlay(stored));

    expect(merged[0]).toMatchObject({
      uuid: 'cdn-b',
      ping: null,
      pingStale: false,
    });
  });
});
