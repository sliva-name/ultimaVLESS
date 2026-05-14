import { describe, expect, it, vi } from 'vitest';
import { createSubscriptionRefreshManager } from './subscriptionRefresh';
import { makeMonitorStatus, makeServer } from '@/test/factories';
import type { VlessConfig } from '@/shared/types';

function createDeps(existingServers: VlessConfig[], refreshed: VlessConfig[]) {
  let servers = existingServers;
  const sent: Array<{ channel: string; args: unknown[] }> = [];

  return {
    sent,
    deps: {
      getWindow: () =>
        ({
          webContents: {
            send: (channel: string, ...args: unknown[]) => {
              sent.push({ channel, args });
            },
          },
        }) as never,
      configService: {
        getSubscriptions: () => [
          {
            id: 'sub-1',
            name: 'Subscription',
            url: 'https://example.com/sub',
            enabled: true,
          },
        ],
        getManualLinksInput: () => '',
        getServers: () => servers,
        setServers: (next: VlessConfig[]) => {
          servers = next;
        },
        getSelectedServerId: () => null,
        setSelectedServerId: vi.fn(),
      },
      subscriptionService: {
        fetchAndParseDetailed: vi
          .fn()
          .mockResolvedValue({ configs: refreshed }),
        parseDirectLinksFromText: vi.fn().mockReturnValue([]),
      },
      connectionMonitorService: {
        getStatus: () => makeMonitorStatus(),
        syncCurrentServer: vi.fn().mockReturnValue(null),
      },
      xrayService: {
        isRunning: () => false,
      },
    },
    getServers: () => servers,
  };
}

describe('createSubscriptionRefreshManager', () => {
  it('does not collapse subscription variants that share the same endpoint', async () => {
    const first = makeServer({
      uuid: 'variant-1',
      address: 'same.example.com',
      port: 443,
      type: 'xhttp',
      path: '/one',
    });
    const second = makeServer({
      uuid: 'variant-2',
      address: 'same.example.com',
      port: 443,
      type: 'xhttp',
      path: '/two',
    });
    const harness = createDeps([], [first, second]);

    const manager = createSubscriptionRefreshManager(harness.deps);
    await manager.queueRefreshAllSubscriptions('');

    expect(harness.getServers()).toHaveLength(2);
    expect(harness.getServers().map((server) => server.uuid)).toEqual([
      'variant-1',
      'variant-2',
    ]);
  });

  it('preserves ping across startup refresh when id and endpoint rotate', async () => {
    const existing = makeServer({
      uuid: 'old-id',
      source: 'subscription',
      subscriptionId: 'sub-1',
      name: 'NL Нидерланды',
      address: 'old.example.com',
      port: 443,
      ping: 96,
      pingTime: 12345,
    });
    const rotated = makeServer({
      uuid: 'new-id',
      source: 'subscription',
      subscriptionId: 'sub-1',
      name: 'NL Нидерланды',
      address: 'new.example.com',
      port: 443,
    });
    const harness = createDeps([existing], [rotated]);

    const manager = createSubscriptionRefreshManager(harness.deps);
    await manager.queueRefreshAllSubscriptions('');

    expect(harness.getServers()).toEqual([
      expect.objectContaining({
        uuid: 'new-id',
        address: 'new.example.com',
        ping: 96,
        pingTime: 12345,
        pingStale: true,
      }),
    ]);
  });

  it('fetches subscriptions concurrently while preserving subscription order', async () => {
    const first = makeServer({ uuid: 'first', name: 'First' });
    const second = makeServer({ uuid: 'second', name: 'Second' });
    let servers: VlessConfig[] = [];
    const pendingFetches: Array<(value: { configs: VlessConfig[] }) => void> =
      [];
    const fetchAndParseDetailed = vi.fn(
      () =>
        new Promise<{ configs: VlessConfig[] }>((resolve) => {
          pendingFetches.push(resolve);
        }),
    );

    const manager = createSubscriptionRefreshManager({
      getWindow: () => null,
      configService: {
        getSubscriptions: () => [
          {
            id: 'sub-1',
            name: 'First subscription',
            url: 'https://example.com/first',
            enabled: true,
          },
          {
            id: 'sub-2',
            name: 'Second subscription',
            url: 'https://example.com/second',
            enabled: true,
          },
        ],
        getManualLinksInput: () => '',
        getServers: () => servers,
        setServers: (next: VlessConfig[]) => {
          servers = next;
        },
        getSelectedServerId: () => null,
        setSelectedServerId: vi.fn(),
      },
      subscriptionService: {
        fetchAndParseDetailed,
        parseDirectLinksFromText: vi.fn().mockReturnValue([]),
      },
      connectionMonitorService: {
        getStatus: () => makeMonitorStatus(),
        syncCurrentServer: vi.fn().mockReturnValue(null),
      },
      xrayService: {
        isRunning: () => false,
      },
    });

    const refresh = manager.queueRefreshAllSubscriptions('');
    await Promise.resolve();

    expect(fetchAndParseDetailed).toHaveBeenCalledTimes(2);
    pendingFetches[1]?.({ configs: [second] });
    pendingFetches[0]?.({ configs: [first] });
    await refresh;

    expect(servers.map((server) => server.uuid)).toEqual(['first', 'second']);
  });
});
