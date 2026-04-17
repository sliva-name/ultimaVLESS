import { Subscription, VlessConfig } from '@/shared/types';

export interface SubscriptionServerGroup {
  subscription: Subscription;
  servers: VlessConfig[];
}

export interface GroupColor {
  dot: string;
  badge: string;
  border: string;
  bg: string;
}

export const SUBSCRIPTION_COLORS: readonly GroupColor[] = [
  { dot: 'bg-blue-400 shadow-blue-400/60',    badge: 'bg-blue-500/15 text-blue-300 border-blue-500/30',       border: 'border-blue-500/20',    bg: 'from-blue-500/8' },
  { dot: 'bg-emerald-400 shadow-emerald-400/60', badge: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30', border: 'border-emerald-500/20', bg: 'from-emerald-500/8' },
  { dot: 'bg-amber-400 shadow-amber-400/60',  badge: 'bg-amber-500/15 text-amber-300 border-amber-500/30',    border: 'border-amber-500/20',   bg: 'from-amber-500/8' },
  { dot: 'bg-rose-400 shadow-rose-400/60',    badge: 'bg-rose-500/15 text-rose-300 border-rose-500/30',       border: 'border-rose-500/20',    bg: 'from-rose-500/8' },
  { dot: 'bg-cyan-400 shadow-cyan-400/60',    badge: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',       border: 'border-cyan-500/20',    bg: 'from-cyan-500/8' },
] as const;

export const ORPHAN_GROUP_COLOR: GroupColor = {
  dot: 'bg-blue-400 shadow-blue-400/60',
  badge: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  border: 'border-blue-500/20',
  bg: 'from-blue-500/8',
};

export const MANUAL_GROUP_COLOR: GroupColor = {
  dot: 'bg-violet-400 shadow-violet-400/60',
  badge: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
  border: 'border-violet-500/20',
  bg: 'from-violet-500/8',
};

/**
 * Returns a stable colour slot for a subscription id.
 * Using a simple fast hash keeps the assignment deterministic across app
 * restarts and independent of the order in which subscriptions are loaded.
 */
export function getSubscriptionColor(subscriptionId: string): GroupColor {
  let hash = 0;
  for (let i = 0; i < subscriptionId.length; i += 1) {
    hash = (hash * 31 + subscriptionId.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(hash) % SUBSCRIPTION_COLORS.length;
  return SUBSCRIPTION_COLORS[idx];
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
