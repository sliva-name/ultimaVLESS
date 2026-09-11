import { randomUUID } from 'crypto';
import type { Subscription } from '@/shared/types';
import { logger } from '@/main/services/LoggerService';
import { getAppStore } from '@/main/infrastructure/persistence/appStore';
import type { SubscriptionRepository } from '@/main/domain/subscription/SubscriptionRepository';

export function createSubscriptionRepository(): SubscriptionRepository {
  const store = getAppStore();
  // `electron-store` re-reads the whole file per `get()`; this repository is
  // the only in-process writer of these keys, so a write-through cache is safe.
  let cachedSubscriptions: Subscription[] | null = null;
  let cachedManualLinks: string | null = null;

  const list = (): Subscription[] => {
    cachedSubscriptions ??= store.get('subscriptions') || [];
    return [...cachedSubscriptions];
  };

  const persist = (subscriptions: Subscription[]): void => {
    store.set('subscriptions', subscriptions);
    cachedSubscriptions = subscriptions;
  };

  return {
    list,
    saveAll(subscriptions: Subscription[]) {
      persist([...subscriptions]);
    },
    add(data) {
      const sub: Subscription = {
        id: randomUUID(),
        name: data.name,
        url: data.url,
        enabled: data.enabled ?? true,
      };
      persist([...list(), sub]);
      logger.info('SubscriptionRepository', 'add', {
        id: sub.id,
        name: sub.name,
      });
      return sub;
    },
    remove(id: string) {
      const existing = list();
      const filtered = existing.filter((sub) => sub.id !== id);
      if (filtered.length === existing.length) return false;
      persist(filtered);
      logger.info('SubscriptionRepository', 'remove', { id });
      return true;
    },
    update(id, patch) {
      const existing = list();
      const index = existing.findIndex((sub) => sub.id === id);
      if (index === -1) return null;
      const updated: Subscription = { ...existing[index], ...patch };
      const next = [...existing];
      next[index] = updated;
      persist(next);
      logger.info('SubscriptionRepository', 'update', { id });
      return updated;
    },
    getManualLinks() {
      cachedManualLinks ??= store.get('manualLinksInput') || '';
      return cachedManualLinks;
    },
    setManualLinks(value: string) {
      store.set('manualLinksInput', value);
      cachedManualLinks = value;
    },
  };
}

let singleton: SubscriptionRepository | null = null;

export function getSubscriptionRepository(): SubscriptionRepository {
  singleton ??= createSubscriptionRepository();
  return singleton;
}
