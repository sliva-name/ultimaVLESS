import Store from 'electron-store';
import {
  isUnmodifiedLegacyPerformanceSettings,
  normalizePerformanceSettings,
} from '@/shared/performanceSettings';
import {
  ConnectionMode,
  DEFAULT_PERFORMANCE_SETTINGS,
  PerformanceSettings,
} from '@/shared/types';
import {
  getAppStore,
  type AppStoreSchema,
} from '@/main/infrastructure/persistence/appStore';
import { logger } from './LoggerService';

export type UiLanguage = 'en' | 'ru';

/**
 * Persistent session/settings store. Server catalog and subscriptions live in
 * ServerRepository / SubscriptionRepository on the same electron-store file.
 */
export class ConfigService {
  private store: Store<AppStoreSchema>;

  constructor() {
    this.store = getAppStore();
    this.migrateLegacyPerformanceDefaults();
    logger.info('ConfigService', 'Initialized', { path: this.store.path });
  }

  /**
   * Older builds defaulted to a feature-heavy Xray config (TCP mux, ad/BT
   * routing, IPIfNonMatch). Move users who never changed those settings to the
   * lean current defaults while preserving explicitly customized values.
   */
  private migrateLegacyPerformanceDefaults(): void {
    const stored = this.store.get('performanceSettings');
    if (!stored || !isUnmodifiedLegacyPerformanceSettings(stored)) {
      return;
    }
    this.store.set('performanceSettings', DEFAULT_PERFORMANCE_SETTINGS);
    logger.info(
      'ConfigService',
      'Migrated legacy performance defaults to lean Xray defaults',
    );
  }

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

  public setPendingTunReconnect(serverId: string): void {
    this.store.set('pendingTunReconnect', {
      serverId,
      createdAt: Date.now(),
    });
  }

  public peekPendingTunReconnect(
    maxAgeMs: number = 2 * 60 * 1000,
  ): string | null {
    return this.readPendingTunReconnect(
      this.store.get('pendingTunReconnect'),
      maxAgeMs,
    );
  }

  public consumePendingTunReconnect(
    maxAgeMs: number = 2 * 60 * 1000,
  ): string | null {
    const pending = this.store.get('pendingTunReconnect');
    this.store.set('pendingTunReconnect', null);
    return this.readPendingTunReconnect(pending, maxAgeMs);
  }

  private readPendingTunReconnect(
    pending: AppStoreSchema['pendingTunReconnect'],
    maxAgeMs: number,
  ): string | null {
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

  public getPerformanceSettings(): PerformanceSettings {
    return normalizePerformanceSettings(this.store.get('performanceSettings'));
  }

  public setPerformanceSettings(settings: PerformanceSettings): void {
    const normalized = normalizePerformanceSettings(settings);
    this.store.set('performanceSettings', normalized);
    logger.info('ConfigService', 'setPerformanceSettings', {
      ...normalized,
      bypassDomains: normalized.bypassDomains.length,
      bypassIps: normalized.bypassIps.length,
    });
  }

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
