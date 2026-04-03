import Store from 'electron-store';
import {
  MOBILE_LIST_TURBOPAGES_DEFAULT_URL,
  MOBILE_WHITE_LIST_RAW_URL,
  YANDEX_TRANSLATED_MOBILE_LIST_URL,
} from '../../shared/subscriptionUrls';
import { ConnectionMode, VlessConfig } from '../../shared/types';
import { logger } from './LoggerService';
import { redactUrl } from '../utils/redactUrl';

const LEGACY_DEFAULT_SUBSCRIPTION_URL = MOBILE_WHITE_LIST_RAW_URL;
const DEFAULT_SUBSCRIPTION_URL = YANDEX_TRANSLATED_MOBILE_LIST_URL;

interface StoreSchema {
  subscriptionUrl: string;
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
        subscriptionUrl: DEFAULT_SUBSCRIPTION_URL,
        manualLinksInput: '',
        servers: [],
        selectedServerId: null,
        connectionMode: 'proxy',
        pendingTunReconnect: null,
      }
    });

    const storedSubscriptionUrl = this.store.get('subscriptionUrl');
    if (!storedSubscriptionUrl?.trim()) {
      this.store.set('subscriptionUrl', DEFAULT_SUBSCRIPTION_URL);
    } else if (storedSubscriptionUrl === LEGACY_DEFAULT_SUBSCRIPTION_URL) {
      this.store.set('subscriptionUrl', DEFAULT_SUBSCRIPTION_URL);
    } else if (storedSubscriptionUrl === MOBILE_LIST_TURBOPAGES_DEFAULT_URL) {
      this.store.set('subscriptionUrl', DEFAULT_SUBSCRIPTION_URL);
    }

    logger.info('ConfigService', 'Initialized', { path: this.store.path });
  }

  /**
   * Retrieves the saved subscription URL.
   * @returns {string} The subscription URL.
   */
  public getSubscriptionUrl(): string {
    const url = this.store.get('subscriptionUrl');
    logger.debug('ConfigService', 'getSubscriptionUrl', {
      hasUrl: !!url,
      redactedUrl: redactUrl(url),
    });
    return url;
  }

  /**
   * Saves the subscription URL.
   * @param {string} url - The new subscription URL.
   */
  public setSubscriptionUrl(url: string): void {
    logger.info('ConfigService', 'setSubscriptionUrl', {
      hasUrl: !!url,
      redactedUrl: redactUrl(url),
    });
    this.store.set('subscriptionUrl', url);
  }

  public getManualLinksInput(): string {
    return this.store.get('manualLinksInput') || '';
  }

  public setManualLinksInput(input: string): void {
    this.store.set('manualLinksInput', input);
  }

  /**
   * Retrieves the list of saved servers.
   * @returns {VlessConfig[]} Array of VLESS server configurations.
   */
  public getServers(): VlessConfig[] {
    const servers = this.store.get('servers') || [];
    logger.debug('ConfigService', 'getServers', { count: servers.length });
    return servers;
  }

  /**
   * Updates the list of servers.
   * @param {VlessConfig[]} servers - The new list of servers.
   */
  public setServers(servers: VlessConfig[]): void {
    logger.info('ConfigService', 'setServers', { count: servers.length });
    this.store.set('servers', servers);
  }

  /**
   * Retrieves the ID (UUID) of the currently selected server.
   * @returns {string | null} The UUID or null if none selected.
   */
  public getSelectedServerId(): string | null {
    return this.store.get('selectedServerId');
  }

  /**
   * Sets the currently selected server ID.
   * @param {string | null} id - The UUID of the server.
   */
  public setSelectedServerId(id: string | null): void {
    this.store.set('selectedServerId', id);
  }

  public getConnectionMode(): ConnectionMode {
    return this.store.get('connectionMode') || 'proxy';
  }

  public setConnectionMode(mode: ConnectionMode): void {
    this.store.set('connectionMode', mode);
  }

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
