import type { AppStoreSchema } from '@desktop/main/infrastructure/persistence/appStore';
import { YANDEX_TRANSLATED_MOBILE_LIST_URL } from '@/shared/subscriptionUrls';
import { DEFAULT_PERFORMANCE_SETTINGS } from '@/shared/types';
import { UltimaCore } from '../native/UltimaCore';

export type { AppStoreSchema };

/**
 * Android counterpart of the desktop `electron-store` file. Callers read and
 * write synchronously, as they do on desktop: the whole document is loaded
 * into memory at boot (`loadAppStore`) and written back to the app's private
 * storage shortly after each change.
 */
export interface MobileAppStore {
  readonly path: string;
  get<K extends keyof AppStoreSchema>(key: K): AppStoreSchema[K];
  set<K extends keyof AppStoreSchema>(key: K, value: AppStoreSchema[K]): void;
  delete(key: keyof AppStoreSchema): void;
}

const PERSIST_DELAY_MS = 250;

const DEFAULTS: AppStoreSchema = {
  subscriptions: [],
  manualLinksInput: '',
  servers: [],
  selectedServerId: null,
  // Android has no system proxy to set; VPN is what users expect.
  connectionMode: 'tun',
  pendingTunReconnect: null,
  performanceSettings: DEFAULT_PERFORMANCE_SETTINGS,
};

let document: Partial<AppStoreSchema> | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let persistChain: Promise<void> = Promise.resolve();

function clone<T>(value: T): T {
  return value === undefined ? value : structuredClone(value);
}

function persistNow(): Promise<void> {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  const json = JSON.stringify(document ?? {});
  persistChain = persistChain
    .then(() => UltimaCore.writeState({ json }))
    .catch((error: unknown) => {
      console.error('Failed to persist app state', error);
    });
  return persistChain;
}

function schedulePersist(): void {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void persistNow();
  }, PERSIST_DELAY_MS);
}

/** Writes pending changes now (app going to the background). */
export function flushAppStore(): Promise<void> {
  return persistTimer ? persistNow() : persistChain;
}

const store: MobileAppStore = {
  path: 'app-state.json',
  get(key) {
    if (!document) throw new Error('App store read before loadAppStore()');
    const value = key in document ? document[key] : DEFAULTS[key];
    return clone(value) as AppStoreSchema[typeof key];
  },
  set(key, value) {
    if (!document) throw new Error('App store written before loadAppStore()');
    document[key] = clone(value);
    schedulePersist();
  },
  delete(key) {
    if (!document) return;
    delete document[key];
    schedulePersist();
  },
};

export async function loadAppStore(): Promise<void> {
  const { json } = await UltimaCore.readState();
  let parsed: Partial<AppStoreSchema> = {};
  if (json) {
    try {
      const value: unknown = JSON.parse(json);
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        parsed = value as Partial<AppStoreSchema>;
      }
    } catch (error) {
      console.error('Stored app state is corrupt; starting fresh', error);
    }
  }
  document = parsed;
  // Same first-run catalog as desktop: the built-in public list.
  if (!document.subscriptions || document.subscriptions.length === 0) {
    store.set('subscriptions', [
      {
        id: globalThis.crypto.randomUUID(),
        name: 'Default',
        url: YANDEX_TRANSLATED_MOBILE_LIST_URL,
        enabled: true,
      },
    ]);
  }
}

export function getAppStore(): MobileAppStore {
  return store;
}
