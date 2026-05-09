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
        fetchAndParseDetailed: vi.fn().mockResolvedValue({ configs: refreshed }),
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
});
