import { randomUUID } from 'crypto';
import Store from 'electron-store';
import {
  MOBILE_LIST_TURBOPAGES_DEFAULT_URL,
  MOBILE_WHITE_LIST_RAW_URL,
  YANDEX_TRANSLATED_MOBILE_LIST_URL,
} from '@/shared/subscriptionUrls';
import {
  ConnectionMode,
  DEFAULT_PERFORMANCE_SETTINGS,
  PerformanceSettings,
  Subscription,
  VlessConfig,
} from '@/shared/types';
import type { UiLanguage } from '@/shared/mainLocales';
import { logger } from './LoggerService';
import { redactUrl } from '@/main/utils/redactUrl';

const CURRENT_SCHEMA_VERSION = 2;
const LEGACY_DEFAULT_SUBSCRIPTION_URLS = new Set([
  MOBILE_WHITE_LIST_RAW_URL,
  MOBILE_LIST_TURBOPAGES_DEFAULT_URL,
  YANDEX_TRANSLATED_MOBILE_LIST_URL,
]);
const DEFAULT_SUBSCRIPTION_URL = YANDEX_TRANSLATED_MOBILE_LIST_URL;
const LEGACY_PERFORMANCE_DEFAULTS: PerformanceSettings = {
  muxEnabled: true,
  muxConcurrency: 8,
  xudpConcurrency: 16,
  xudpProxyUDP443: 'reject',
  tcpFastOpen: true,
  sniffingRouteOnly: true,
  logLevel: 'warning',
  fingerprint: 'chrome',
  blockAds: true,
  blockBittorrent: true,
  domainStrategy: 'IPIfNonMatch',
};

const PING_PERSIST_DEBOUNCE_MS = 1000;

interface StoreSchema {
  schemaVersion: number;
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
  performanceSettings: PerformanceSettings;
  uiLanguage?: UiLanguage;
}

/**
 * Service for managing persistent application configuration.
 * Uses electron-store to save user preferences and server lists to disk.
 */
export class ConfigService {
  private store: Store<StoreSchema>;
  private pendingPingPersistTimer: NodeJS.Timeout | null = null;
  private pendingPingServers: VlessConfig[] | null = null;

  constructor() {
    this.store = new Store<StoreSchema>({
      name: 'app-config',
      defaults: {
        subscriptions: [],
        schemaVersion: CURRENT_SCHEMA_VERSION,
        manualLinksInput: '',
        servers: [],
        selectedServerId: null,
        connectionMode: 'proxy',
        pendingTunReconnect: null,
        performanceSettings: DEFAULT_PERFORMANCE_SETTINGS,
      },
    });

    this.migrateStore();
    logger.info('ConfigService', 'Initialized', { path: this.store.path });
  }

  private migrateStore(): void {
    this.migrateLegacySubscriptionUrl();
    this.migrateLegacyPerformanceDefaults();
    this.store.set('schemaVersion', CURRENT_SCHEMA_VERSION);
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
        if (LEGACY_DEFAULT_SUBSCRIPTION_URLS.has(migratedUrl)) {
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
        logger.info(
          'ConfigService',
          'Migrated legacy subscriptionUrl to subscriptions list',
          {
            redactedUrl: redactUrl(migratedUrl),
          },
        );
      }
    } else if (
      !this.store.get('subscriptions') ||
      this.store.get('subscriptions').length === 0
    ) {
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
    (this.store as unknown as { delete: (key: string) => void }).delete(
      'subscriptionUrl',
    );
  }

  /**
   * Older builds defaulted to a feature-heavy Xray config (TCP mux, ad/BT
   * routing, IPIfNonMatch). Move users who never changed those settings to the
   * lean current defaults while preserving explicitly customized values.
   */
  private migrateLegacyPerformanceDefaults(): void {
    const stored = this.store.get('performanceSettings');
    if (!stored || !this.matchesPerformanceSettings(stored)) {
      return;
    }
    this.store.set('performanceSettings', DEFAULT_PERFORMANCE_SETTINGS);
    logger.info(
      'ConfigService',
      'Migrated legacy performance defaults to lean Xray defaults',
    );
  }

  private matchesPerformanceSettings(settings: PerformanceSettings): boolean {
    return (
      settings.muxEnabled === LEGACY_PERFORMANCE_DEFAULTS.muxEnabled &&
      settings.muxConcurrency === LEGACY_PERFORMANCE_DEFAULTS.muxConcurrency &&
      settings.xudpConcurrency === LEGACY_PERFORMANCE_DEFAULTS.xudpConcurrency &&
      settings.xudpProxyUDP443 ===
        LEGACY_PERFORMANCE_DEFAULTS.xudpProxyUDP443 &&
      settings.tcpFastOpen === LEGACY_PERFORMANCE_DEFAULTS.tcpFastOpen &&
      settings.sniffingRouteOnly ===
        LEGACY_PERFORMANCE_DEFAULTS.sniffingRouteOnly &&
      settings.logLevel === LEGACY_PERFORMANCE_DEFAULTS.logLevel &&
      settings.fingerprint === LEGACY_PERFORMANCE_DEFAULTS.fingerprint &&
      settings.blockAds === LEGACY_PERFORMANCE_DEFAULTS.blockAds &&
      settings.blockBittorrent ===
        LEGACY_PERFORMANCE_DEFAULTS.blockBittorrent &&
      settings.domainStrategy === LEGACY_PERFORMANCE_DEFAULTS.domainStrategy
    );
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

  public addSubscription(data: {
    name: string;
    url: string;
    enabled?: boolean;
  }): Subscription {
    const sub: Subscription = {
      id: randomUUID(),
      name: data.name,
      url: data.url,
      enabled: data.enabled ?? true,
    };
    const existing = this.getSubscriptions();
    this.store.set('subscriptions', [...existing, sub]);
    logger.info('ConfigService', 'addSubscription', {
      id: sub.id,
      name: sub.name,
    });
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
    patch: Partial<Pick<Subscription, 'name' | 'url' | 'enabled'>>,
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
    this.clearPendingPingPersist();
    logger.info('ConfigService', 'setServers', { count: servers.length });
    this.store.set('servers', servers);
  }

  public setServerPingPatches(
    patches: Array<{
      uuid: string;
      ping: number | null;
      pingTime: number;
      pingStale?: boolean;
    }>,
    options: { debounce?: boolean } = {},
  ): VlessConfig[] {
    if (patches.length === 0) {
      return this.getServers();
    }

    const patchById = new Map(patches.map((patch) => [patch.uuid, patch]));
    const baselineServers = this.pendingPingServers ?? this.getServers();
    const nextServers = baselineServers.map((server) => {
      const patch = patchById.get(server.uuid);
      if (!patch) {
        return server;
      }
      return {
        ...server,
        ping: patch.ping,
        pingTime: patch.pingTime,
        pingStale: patch.pingStale ?? false,
      };
    });

    this.pendingPingServers = nextServers;

    const persist = () => {
      const serversToPersist = this.pendingPingServers ?? nextServers;
      logger.info('ConfigService', 'setServerPingPatches', {
        count: serversToPersist.length,
        patchCount: patches.length,
      });
      this.store.set('servers', serversToPersist);
      this.pendingPingServers = null;
    };

    if (options.debounce) {
      this.cancelPendingPingPersistTimer();
      this.pendingPingPersistTimer = setTimeout(() => {
        this.pendingPingPersistTimer = null;
        persist();
      }, PING_PERSIST_DEBOUNCE_MS);
    } else {
      this.cancelPendingPingPersistTimer();
      persist();
    }

    return nextServers;
  }

  private clearPendingPingPersist(): void {
    this.cancelPendingPingPersistTimer();
    this.pendingPingServers = null;
  }

  private cancelPendingPingPersistTimer(): void {
    if (this.pendingPingPersistTimer) {
      clearTimeout(this.pendingPingPersistTimer);
      this.pendingPingPersistTimer = null;
    }
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

  public consumePendingTunReconnect(
    maxAgeMs: number = 2 * 60 * 1000,
  ): string | null {
    const pending = this.store.get('pendingTunReconnect');
    this.store.set('pendingTunReconnect', null);
    if (
      !pending ||
      typeof pending.serverId !== 'string' ||
      typeof pending.createdAt !== 'number'
    ) {
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

  // ---------------------------------------------------------------------------
  // Performance settings
  // ---------------------------------------------------------------------------

  public getPerformanceSettings(): PerformanceSettings {
    const stored = this.store.get('performanceSettings');
    return { ...DEFAULT_PERFORMANCE_SETTINGS, ...stored };
  }

  public setPerformanceSettings(settings: PerformanceSettings): void {
    this.store.set('performanceSettings', settings);
    logger.info('ConfigService', 'setPerformanceSettings', settings);
  }

  // ---------------------------------------------------------------------------
  // UI language (shared between main and renderer so the tray / notifications
  // can be localized without round-tripping through the renderer first).
  // ---------------------------------------------------------------------------

  public getUiLanguage(): UiLanguage {
    const stored = this.store.get('uiLanguage');
    return stored === 'en' || stored === 'ru' ? stored : 'ru';
  }

  public setUiLanguage(language: UiLanguage): void {
    this.store.set('uiLanguage', language);
    logger.info('ConfigService', 'setUiLanguage', { language });
  }
}

export const configService = new ConfigService();
