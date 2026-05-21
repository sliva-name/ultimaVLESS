import { describe, expect, it } from 'vitest';
import { buildSidebarServerBuckets, partitionServers } from './sidebarModel';
import type { Subscription, VlessConfig } from '@/shared/types';

function server(partial: Partial<VlessConfig>): VlessConfig {
  return {
    uuid: partial.uuid ?? 'id',
    address: '1.1.1.1',
    port: 443,
    name: partial.name ?? 'srv',
    ...partial,
  };
}

describe('sidebarModel', () => {
  it('partitions servers in a single pass', () => {
    const servers = [
      server({ uuid: '1', subscriptionId: 'sub-a', source: 'subscription' }),
      server({ uuid: '2', source: 'manual' }),
      server({ uuid: '3', source: 'subscription' }),
    ];
    const buckets = partitionServers(servers);
    expect(buckets.bySubscriptionId.get('sub-a')).toHaveLength(1);
    expect(buckets.manualServers).toHaveLength(1);
    expect(buckets.orphanSubscriptionServers).toHaveLength(1);
  });

  it('builds enabled subscription groups only', () => {
    const subscriptions: Subscription[] = [
      { id: 'sub-a', name: 'A', url: 'https://x', enabled: true },
      { id: 'sub-b', name: 'B', url: 'https://y', enabled: false },
    ];
    const servers = [
      server({ uuid: '1', subscriptionId: 'sub-a', source: 'subscription', ping: 50 }),
      server({ uuid: '2', subscriptionId: 'sub-b', source: 'subscription', ping: 10 }),
    ];
    const { subscriptionGroups } = buildSidebarServerBuckets(
      subscriptions,
      servers,
    );
    expect(subscriptionGroups).toHaveLength(1);
    expect(subscriptionGroups[0]?.servers[0]?.uuid).toBe('1');
  });
});
