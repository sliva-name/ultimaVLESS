import {
  DEFAULT_PERFORMANCE_SETTINGS,
  PerformanceSettings,
  VALID_DOMAIN_STRATEGIES,
  VALID_LOG_LEVELS,
  VALID_TLS_FINGERPRINTS,
  VALID_XUDP_PROXY_UDP_443_VALUES,
} from './types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, value));
}

export function normalizePerformanceSettings(value: unknown): PerformanceSettings {
  if (!isRecord(value)) {
    return DEFAULT_PERFORMANCE_SETTINGS;
  }

  return {
    muxEnabled: typeof value.muxEnabled === 'boolean' ? value.muxEnabled : DEFAULT_PERFORMANCE_SETTINGS.muxEnabled,
    muxConcurrency: clamp(value.muxConcurrency, 1, 128, DEFAULT_PERFORMANCE_SETTINGS.muxConcurrency),
    xudpConcurrency: clamp(value.xudpConcurrency, 1, 1024, DEFAULT_PERFORMANCE_SETTINGS.xudpConcurrency),
    xudpProxyUDP443: VALID_XUDP_PROXY_UDP_443_VALUES.includes(value.xudpProxyUDP443 as PerformanceSettings['xudpProxyUDP443'])
      ? (value.xudpProxyUDP443 as PerformanceSettings['xudpProxyUDP443'])
      : DEFAULT_PERFORMANCE_SETTINGS.xudpProxyUDP443,
    tcpFastOpen: typeof value.tcpFastOpen === 'boolean' ? value.tcpFastOpen : DEFAULT_PERFORMANCE_SETTINGS.tcpFastOpen,
    sniffingRouteOnly: typeof value.sniffingRouteOnly === 'boolean'
      ? value.sniffingRouteOnly
      : DEFAULT_PERFORMANCE_SETTINGS.sniffingRouteOnly,
    logLevel: VALID_LOG_LEVELS.includes(value.logLevel as PerformanceSettings['logLevel'])
      ? (value.logLevel as PerformanceSettings['logLevel'])
      : DEFAULT_PERFORMANCE_SETTINGS.logLevel,
    fingerprint: VALID_TLS_FINGERPRINTS.includes(value.fingerprint as PerformanceSettings['fingerprint'])
      ? (value.fingerprint as PerformanceSettings['fingerprint'])
      : DEFAULT_PERFORMANCE_SETTINGS.fingerprint,
    blockAds: typeof value.blockAds === 'boolean' ? value.blockAds : DEFAULT_PERFORMANCE_SETTINGS.blockAds,
    blockBittorrent: typeof value.blockBittorrent === 'boolean'
      ? value.blockBittorrent
      : DEFAULT_PERFORMANCE_SETTINGS.blockBittorrent,
    domainStrategy: VALID_DOMAIN_STRATEGIES.includes(value.domainStrategy as PerformanceSettings['domainStrategy'])
      ? (value.domainStrategy as PerformanceSettings['domainStrategy'])
      : DEFAULT_PERFORMANCE_SETTINGS.domainStrategy,
  };
}
