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
import { redactUrl } from '@/main/utils/redactUrl';
import { logger } from '@/main/services/LoggerService';

const LEGACY_DEFAULT_SUBSCRIPTION_URL = MOBILE_WHITE_LIST_RAW_URL;
const DEFAULT_SUBSCRIPTION_URL = YANDEX_TRANSLATED_MOBILE_LIST_URL;

export interface AppStoreSchema {
  subscriptionUrl?: string;
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
  uiLanguage?: 'ru' | 'en';
}

let appStore: Store<AppStoreSchema> | null = null;

export function getAppStore(): Store<AppStoreSchema> {
  if (appStore) {
    return appStore;
  }
  appStore = new Store<AppStoreSchema>({
    name: 'app-config',
    defaults: {
      subscriptions: [],
      manualLinksInput: '',
      servers: [],
      selectedServerId: null,
      connectionMode: 'proxy',
      pendingTunReconnect: null,
      performanceSettings: DEFAULT_PERFORMANCE_SETTINGS,
    },
  });
  migrateLegacySubscriptionUrl(appStore);
  logger.info('AppStore', 'Initialized', { path: appStore.path });
  return appStore;
}

function migrateLegacySubscriptionUrl(store: Store<AppStoreSchema>): void {
  const legacyUrl = store.get('subscriptionUrl');
  if (typeof legacyUrl === 'string' && legacyUrl.trim()) {
    const existing = store.get('subscriptions');
    if (!existing || existing.length === 0) {
      let migratedUrl = legacyUrl;
      if (
        migratedUrl === LEGACY_DEFAULT_SUBSCRIPTION_URL ||
        migratedUrl === MOBILE_LIST_TURBOPAGES_DEFAULT_URL
      ) {
        migratedUrl = DEFAULT_SUBSCRIPTION_URL;
      }
      store.set('subscriptions', [
        {
          id: randomUUID(),
          name: 'Default',
          url: migratedUrl,
          enabled: true,
        },
      ]);
      logger.info(
        'AppStore',
        'Migrated legacy subscriptionUrl to subscriptions list',
        { redactedUrl: redactUrl(migratedUrl) },
      );
    }
  } else if (!store.get('subscriptions') || store.get('subscriptions').length === 0) {
    store.set('subscriptions', [
      {
        id: randomUUID(),
        name: 'Default',
        url: DEFAULT_SUBSCRIPTION_URL,
        enabled: true,
      },
    ]);
  }

  (store as unknown as { delete: (key: string) => void }).delete('subscriptionUrl');
}
