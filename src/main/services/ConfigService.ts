import { randomUUID } from 'crypto';
import Store from 'electron-store';
import {
  MOBILE_LIST_TURBOPAGES_DEFAULT_URL,
  MOBILE_WHITE_LIST_RAW_URL,
  YANDEX_TRANSLATED_MOBILE_LIST_URL,
} from '../../shared/subscriptionUrls';
import { ConnectionMode, Subscription, VlessConfig } from '../../shared/types';
import { logger } from './LoggerService';
import { redactUrl } from '../utils/redactUrl';

const LEGACY_DEFAULT_SUBSCRIPTION_URL = MOBILE_WHITE_LIST_RAW_URL;
const DEFAULT_SUBSCRIPTION_URL = YANDEX_TRANSLATED_MOBILE_LIST_URL;

interface StoreSchema {
  subscriptionUrl?: string; // legacy field — migrated on first init and then deleted
  subscriptions: Subscription[];
  manualLinksInput: string;
  servers: VlessConfig[];
  selectedServerId: string | null;
  connectionMode: ConnectionMode;
  pendingTunReconnect: {
    serverId: string;
    createdAt: number;
  } | null;
}

/**
 * Service for managing persistent application configuration.
 * Uses electron-store to save user preferences and server lists to disk.
 */
export class ConfigService {
  private store: Store<StoreSchema>;

  constructor() {
    this.store = new Store<StoreSchema>({
      name: 'app-config',
      defaults: {
        subscriptions: [],
        manualLinksInput: '',
        servers: [],
        selectedServerId: null,
        connectionMode: 'proxy',
        pendingTunReconnect: null,
      }
    });

    this.migrateLegacySubscriptionUrl();
    logger.info('ConfigService', 'Initialized', { path: this.store.path });
  }

  /**
   * Migrates the legacy single `subscriptionUrl` string to the new `subscriptions` array.
   * Runs once on first launch after the upgrade and then removes the old key.
   */
  private migrateLegacySubscriptionUrl(): void {
    const legacyUrl = this.store.get('subscriptionUrl');
    if (typeof legacyUrl === 'string' && legacyUrl.trim()) {
      const existing = this.store.get('subscriptions');
      if (!existing || existing.length === 0) {
        // Normalize legacy default URLs to the current default before migrating.
        let migratedUrl = legacyUrl;
        if (
          migratedUrl === LEGACY_DEFAULT_SUBSCRIPTION_URL ||
          migratedUrl === MOBILE_LIST_TURBOPAGES_DEFAULT_URL
        ) {
          migratedUrl = DEFAULT_SUBSCRIPTION_URL;
        }
        this.store.set('subscriptions', [
          {
            id: randomUUID(),
            name: 'Default',
            url: migratedUrl,
            enabled: true,
          },
        ]);
        logger.info('ConfigService', 'Migrated legacy subscriptionUrl to subscriptions list', {
          redactedUrl: redactUrl(migratedUrl),
        });
      }
    } else if (!this.store.get('subscriptions') || this.store.get('subscriptions').length === 0) {
      // Fresh install: seed with the default subscription.
      this.store.set('subscriptions', [
        {
          id: randomUUID(),
          name: 'Default',
          url: DEFAULT_SUBSCRIPTION_URL,
          enabled: true,
        },
      ]);
    }

    // Remove the legacy key regardless so it does not linger.
    (this.store as unknown as { delete: (key: string) => void }).delete('subscriptionUrl');
  }

  // ---------------------------------------------------------------------------
  // Subscriptions
  // ---------------------------------------------------------------------------

  public getSubscriptions(): Subscription[] {
    return this.store.get('subscriptions') || [];
  }

  public setSubscriptions(subs: Subscription[]): void {
    this.store.set('subscriptions', subs);
  }

  public addSubscription(data: { name: string; url: string; enabled?: boolean }): Subscription {
    const sub: Subscription = {
      id: randomUUID(),
      name: data.name,
      url: data.url,
      enabled: data.enabled ?? true,
    };
    const existing = this.getSubscriptions();
    this.store.set('subscriptions', [...existing, sub]);
    logger.info('ConfigService', 'addSubscription', { id: sub.id, name: sub.name });
    return sub;
  }

  public removeSubscription(id: string): boolean {
    const existing = this.getSubscriptions();
    const filtered = existing.filter((s) => s.id !== id);
    if (filtered.length === existing.length) return false;
    this.store.set('subscriptions', filtered);
    logger.info('ConfigService', 'removeSubscription', { id });
    return true;
  }

  public updateSubscription(
    id: string,
    patch: Partial<Pick<Subscription, 'name' | 'url' | 'enabled'>>
  ): Subscription | null {
    const existing = this.getSubscriptions();
    const idx = existing.findIndex((s) => s.id === id);
    if (idx === -1) return null;
    const updated: Subscription = { ...existing[idx], ...patch };
    const next = [...existing];
    next[idx] = updated;
    this.store.set('subscriptions', next);
    logger.info('ConfigService', 'updateSubscription', { id });
    return updated;
  }

  // ---------------------------------------------------------------------------
  // Manual links
  // ---------------------------------------------------------------------------

  public getManualLinksInput(): string {
    return this.store.get('manualLinksInput') || '';
  }

  public setManualLinksInput(input: string): void {
    this.store.set('manualLinksInput', input);
  }

  // ---------------------------------------------------------------------------
  // Servers
  // ---------------------------------------------------------------------------

  /**
   * Retrieves the list of saved servers.
   */
  public getServers(): VlessConfig[] {
    const servers = this.store.get('servers') || [];
    logger.debug('ConfigService', 'getServers', { count: servers.length });
    return servers;
  }

  /**
   * Updates the list of servers.
   */
  public setServers(servers: VlessConfig[]): void {
    logger.info('ConfigService', 'setServers', { count: servers.length });
    this.store.set('servers', servers);
  }

  // ---------------------------------------------------------------------------
  // Selection / connection mode
  // ---------------------------------------------------------------------------

  public getSelectedServerId(): string | null {
    return this.store.get('selectedServerId');
  }

  public setSelectedServerId(id: string | null): void {
    this.store.set('selectedServerId', id);
  }

  public getConnectionMode(): ConnectionMode {
    return this.store.get('connectionMode') || 'proxy';
  }

  public setConnectionMode(mode: ConnectionMode): void {
    this.store.set('connectionMode', mode);
  }

  // ---------------------------------------------------------------------------
  // Pending TUN reconnect
  // ---------------------------------------------------------------------------

  public setPendingTunReconnect(serverId: string): void {
    this.store.set('pendingTunReconnect', {
      serverId,
      createdAt: Date.now(),
    });
  }

  public consumePendingTunReconnect(maxAgeMs: number = 2 * 60 * 1000): string | null {
    const pending = this.store.get('pendingTunReconnect');
    this.store.set('pendingTunReconnect', null);
    if (!pending || typeof pending.serverId !== 'string' || typeof pending.createdAt !== 'number') {
      return null;
    }

    const ageMs = Date.now() - pending.createdAt;
    if (ageMs < 0 || ageMs > maxAgeMs) {
      logger.info('ConfigService', 'Dropped stale pending TUN reconnect', {
        ageMs,
        maxAgeMs,
      });
      return null;
    }

    return pending.serverId;
  }

  public clearPendingTunReconnect(): void {
    this.store.set('pendingTunReconnect', null);
  }
}

export const configService = new ConfigService();
