import {
  DEFAULT_PERFORMANCE_SETTINGS,
  PerformanceSettings,
  REMOTE_DNS_PRESET_SERVERS,
  RemoteDnsPreset,
  VALID_DOMAIN_STRATEGIES,
  VALID_LOG_LEVELS,
  VALID_REMOTE_DNS_PRESETS,
  VALID_TLS_FINGERPRINTS,
  VALID_XUDP_PROXY_UDP_443_VALUES,
  WindowsTunRouting,
} from './types';
import { VALID_WINDOWS_TUN_ROUTING } from './tunRouting';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function clamp(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, value));
}

/** Strict IPv4 dotted-quad without leading zeros (except `0`). */
export function isValidIpv4Address(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  const parts = trimmed.split('.');
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false;
    const n = Number(part);
    return n >= 0 && n <= 255 && String(n) === part;
  });
}

function normalizeIpv4List(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    if (!isValidIpv4Address(entry)) continue;
    const ip = entry.trim();
    if (!out.includes(ip)) out.push(ip);
    if (out.length >= 2) break;
  }
  return out;
}

export function resolveRemoteDnsServers(
  preset: RemoteDnsPreset,
  customServers: unknown,
): string[] {
  if (preset !== 'custom') {
    return [...REMOTE_DNS_PRESET_SERVERS[preset]];
  }
  const custom = normalizeIpv4List(customServers);
  return custom.length > 0
    ? custom
    : [...DEFAULT_PERFORMANCE_SETTINGS.remoteDnsServers];
}

export function normalizePerformanceSettings(
  value: unknown,
): PerformanceSettings {
  if (!isRecord(value)) {
    return DEFAULT_PERFORMANCE_SETTINGS;
  }

  const remoteDnsPreset = VALID_REMOTE_DNS_PRESETS.includes(
    value.remoteDnsPreset as RemoteDnsPreset,
  )
    ? (value.remoteDnsPreset as RemoteDnsPreset)
    : DEFAULT_PERFORMANCE_SETTINGS.remoteDnsPreset;

  return {
    muxEnabled:
      typeof value.muxEnabled === 'boolean'
        ? value.muxEnabled
        : DEFAULT_PERFORMANCE_SETTINGS.muxEnabled,
    muxConcurrency: clamp(
      value.muxConcurrency,
      1,
      128,
      DEFAULT_PERFORMANCE_SETTINGS.muxConcurrency,
    ),
    xudpConcurrency: clamp(
      value.xudpConcurrency,
      1,
      1024,
      DEFAULT_PERFORMANCE_SETTINGS.xudpConcurrency,
    ),
    xudpProxyUDP443: VALID_XUDP_PROXY_UDP_443_VALUES.includes(
      value.xudpProxyUDP443 as PerformanceSettings['xudpProxyUDP443'],
    )
      ? (value.xudpProxyUDP443 as PerformanceSettings['xudpProxyUDP443'])
      : DEFAULT_PERFORMANCE_SETTINGS.xudpProxyUDP443,
    xhttpMaxConnections: clamp(
      value.xhttpMaxConnections,
      1,
      16,
      DEFAULT_PERFORMANCE_SETTINGS.xhttpMaxConnections,
    ),
    remoteDnsPreset,
    remoteDnsServers: resolveRemoteDnsServers(
      remoteDnsPreset,
      value.remoteDnsServers,
    ),
    tcpFastOpen:
      typeof value.tcpFastOpen === 'boolean'
        ? value.tcpFastOpen
        : DEFAULT_PERFORMANCE_SETTINGS.tcpFastOpen,
    sniffingRouteOnly:
      typeof value.sniffingRouteOnly === 'boolean'
        ? value.sniffingRouteOnly
        : DEFAULT_PERFORMANCE_SETTINGS.sniffingRouteOnly,
    logLevel: VALID_LOG_LEVELS.includes(
      value.logLevel as PerformanceSettings['logLevel'],
    )
      ? (value.logLevel as PerformanceSettings['logLevel'])
      : DEFAULT_PERFORMANCE_SETTINGS.logLevel,
    fingerprint: VALID_TLS_FINGERPRINTS.includes(
      value.fingerprint as PerformanceSettings['fingerprint'],
    )
      ? (value.fingerprint as PerformanceSettings['fingerprint'])
      : DEFAULT_PERFORMANCE_SETTINGS.fingerprint,
    blockAds:
      typeof value.blockAds === 'boolean'
        ? value.blockAds
        : DEFAULT_PERFORMANCE_SETTINGS.blockAds,
    blockBittorrent:
      typeof value.blockBittorrent === 'boolean'
        ? value.blockBittorrent
        : DEFAULT_PERFORMANCE_SETTINGS.blockBittorrent,
    domainStrategy: VALID_DOMAIN_STRATEGIES.includes(
      value.domainStrategy as PerformanceSettings['domainStrategy'],
    )
      ? (value.domainStrategy as PerformanceSettings['domainStrategy'])
      : DEFAULT_PERFORMANCE_SETTINGS.domainStrategy,
    windowsTunRouting: VALID_WINDOWS_TUN_ROUTING.includes(
      value.windowsTunRouting as WindowsTunRouting,
    )
      ? (value.windowsTunRouting as WindowsTunRouting)
      : DEFAULT_PERFORMANCE_SETTINGS.windowsTunRouting,
  };
}
