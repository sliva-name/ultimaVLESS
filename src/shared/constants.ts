/** Bundled Xray-core release (see scripts/prepare-xray-assets.mjs). */
export const BUNDLED_XRAY_VERSION = 'v26.10.31';

/** Interface languages, in the order the language pickers list them. */
export const SUPPORTED_LANGUAGES = [
  'ru',
  'en',
  'zh',
  'fa',
  'es',
  'tr',
] as const;

export type UiLanguage = (typeof SUPPORTED_LANGUAGES)[number];

/** Used until the user picks a language. */
export const DEFAULT_LANGUAGE: UiLanguage = 'ru';

export function isSupportedLanguage(lang: unknown): lang is UiLanguage {
  return SUPPORTED_LANGUAGES.includes(lang as UiLanguage);
}

/** "es-MX" → "es"; anything unsupported → the default language. */
export function toUiLanguage(tag: string | null | undefined): UiLanguage {
  const base = tag?.split(/[-_]/)[0].toLowerCase();
  return isSupportedLanguage(base) ? base : DEFAULT_LANGUAGE;
}

/**
 * Each language under its own name, described in itself, so a user who
 * cannot read the current interface still finds theirs.
 */
export const LANGUAGE_NAMES: Record<
  UiLanguage,
  { name: string; desc: string }
> = {
  ru: { name: 'Русский', desc: 'Интерфейс, трей и уведомления' },
  en: { name: 'English', desc: 'Interface, tray and notifications' },
  zh: { name: '中文', desc: '界面、托盘和通知' },
  fa: { name: 'فارسی', desc: 'رابط، سینی و اعلان‌ها' },
  es: { name: 'Español', desc: 'Interfaz, bandeja y notificaciones' },
  tr: { name: 'Türkçe', desc: 'Arayüz, tepsi ve bildirimler' },
};

/**
 * Passed to the instance that UltimaVLESS starts for itself when it needs
 * Administrator rights. It marks a launch that must keep booting instead of
 * handing activation back to the instance it is replacing.
 */
export const RELAUNCH_ARG = '--ultima-relaunch';

export const APP_CONSTANTS = {
  PORTS: {
    SOCKS: 10808,
    HTTP: 10809,
    /**
     * Loopback port Xray exposes its internal gRPC API on while running.
     * Used by the TrafficStatsService to poll StatsService counters.
     */
    API: 10810,
    /** Idle slot used to bring up a second Xray during transactional proxy switch. */
    STAGING_SOCKS: 10818,
    STAGING_HTTP: 10819,
    STAGING_API: 10820,
  },
  TIMEOUTS: {
    /**
     * Per-request budget for a subscription fetch (each redirect hop gets its
     * own). Generous because translate.yandex.ru pages are slow to render, and
     * nothing user-facing waits on the refresh anymore.
     */
    SUBSCRIPTION_FETCH: 30_000,
  },
};

export interface RuntimePorts {
  socks: number;
  http: number;
  api: number;
}

export const PRIMARY_RUNTIME_PORTS: RuntimePorts = {
  socks: APP_CONSTANTS.PORTS.SOCKS,
  http: APP_CONSTANTS.PORTS.HTTP,
  api: APP_CONSTANTS.PORTS.API,
};

export const STAGING_RUNTIME_PORTS: RuntimePorts = {
  socks: APP_CONSTANTS.PORTS.STAGING_SOCKS,
  http: APP_CONSTANTS.PORTS.STAGING_HTTP,
  api: APP_CONSTANTS.PORTS.STAGING_API,
};

export function otherRuntimePorts(current: RuntimePorts): RuntimePorts {
  return current.socks === PRIMARY_RUNTIME_PORTS.socks
    ? { ...STAGING_RUNTIME_PORTS }
    : { ...PRIMARY_RUNTIME_PORTS };
}
