import { randomUUID } from 'crypto';
import type { Subscription } from '@/shared/types';
import { logger } from '@/main/services/LoggerService';
import { getAppStore } from '@/main/infrastructure/persistence/appStore';
import type { SubscriptionRepository } from '@/main/domain/subscription/SubscriptionRepository';

export function createSubscriptionRepository(): SubscriptionRepository {
  const store = getAppStore();

  const list = (): Subscription[] => store.get('subscriptions') || [];

  return {
    list,
    saveAll(subscriptions: Subscription[]) {
      store.set('subscriptions', subscriptions);
    },
    add(data) {
      const sub: Subscription = {
        id: randomUUID(),
        name: data.name,
        url: data.url,
        enabled: data.enabled ?? true,
      };
      store.set('subscriptions', [...list(), sub]);
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
      store.set('subscriptions', filtered);
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
      store.set('subscriptions', next);
      logger.info('SubscriptionRepository', 'update', { id });
      return updated;
    },
    getManualLinks() {
      return store.get('manualLinksInput') || '';
    },
    setManualLinks(value: string) {
      store.set('manualLinksInput', value);
    },
  };
}

let singleton: SubscriptionRepository | null = null;

export function getSubscriptionRepository(): SubscriptionRepository {
  singleton ??= createSubscriptionRepository();
  return singleton;
}
