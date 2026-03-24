import Store from 'electron-store';
import { ConnectionMode, VlessConfig } from '../../shared/types';
import { logger } from './LoggerService';

interface StoreSchema {
  subscriptionUrl: string;
  manualLinksInput: string;
  servers: VlessConfig[];
  selectedServerId: string | null;
  connectionMode: ConnectionMode;
}

/**
 * Service for managing persistent application configuration.
 * Uses electron-store to save user preferences and server lists to disk.
 */
export class ConfigService {
  private store: Store<StoreSchema>;
  private redactUrl(url: string): string {
    if (!url) return '';
    try {
      const parsed = new URL(url);
      return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
    } catch {
      return '[invalid-url]';
    }
  }

  constructor() {
    this.store = new Store<StoreSchema>({
      name: 'app-config',
      defaults: {
        subscriptionUrl: '',
        manualLinksInput: '',
        servers: [],
        selectedServerId: null,
        connectionMode: 'proxy'
      }
    });
    logger.info('ConfigService', 'Initialized', { path: this.store.path });
  }

  /**
   * Retrieves the saved subscription URL.
   * @returns {string} The subscription URL.
   */
  public getSubscriptionUrl(): string {
    const url = this.store.get('subscriptionUrl');
    logger.info('ConfigService', 'getSubscriptionUrl', {
      hasUrl: !!url,
      redactedUrl: this.redactUrl(url),
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
      redactedUrl: this.redactUrl(url),
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
    logger.info('ConfigService', 'getServers', { count: servers.length });
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
}

export const configService = new ConfigService();
