import type { Subscription } from '@/shared/types';

export interface SubscriptionRepository {
  list(): Subscription[];
  saveAll(subscriptions: Subscription[]): void;
  add(data: { name: string; url: string; enabled?: boolean }): Subscription;
  remove(id: string): boolean;
  update(
    id: string,
    patch: Partial<Pick<Subscription, 'name' | 'url' | 'enabled'>>,
  ): Subscription | null;
  getManualLinks(): string;
  setManualLinks(value: string): void;
}
