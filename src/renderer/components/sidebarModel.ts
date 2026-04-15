import { Subscription, VlessConfig } from '../../shared/types';

export interface SubscriptionServerGroup {
  subscription: Subscription;
  servers: VlessConfig[];
}

export function sortByPingAvailability(items: VlessConfig[]): VlessConfig[] {
  return [...items].sort((a, b) => {
    const aPing = a.ping;
    const bPing = b.ping;
    const aAvailable = typeof aPing === 'number' && Number.isFinite(aPing);
    const bAvailable = typeof bPing === 'number' && Number.isFinite(bPing);
    if (aAvailable && bAvailable) return aPing - bPing;
    if (aAvailable && !bAvailable) return -1;
    if (!aAvailable && bAvailable) return 1;
    return 0;
  });
}

export function buildSubscriptionGroups(
  subscriptions: Subscription[],
  servers: VlessConfig[]
): SubscriptionServerGroup[] {
  return subscriptions
    .filter((subscription) => subscription.enabled)
    .map((subscription) => ({
      subscription,
      servers: sortByPingAvailability(servers.filter((server) => server.subscriptionId === subscription.id)),
    }))
    .filter((group) => group.servers.length > 0);
}

export function buildOrphanSubscriptionServers(servers: VlessConfig[]): VlessConfig[] {
  return sortByPingAvailability(servers.filter((server) => server.source !== 'manual' && !server.subscriptionId));
}

export function buildManualServers(servers: VlessConfig[]): VlessConfig[] {
  return sortByPingAvailability(servers.filter((server) => server.source === 'manual'));
}
