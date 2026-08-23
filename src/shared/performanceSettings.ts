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
import { isValidIpv4Address } from './networkAddresses';
import { normalizeBypassDomains, normalizeBypassIps } from './splitTunneling';

export { isValidIpv4Address };

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

export function sameStringList(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

/** Structural equality across every persisted performance field. */
export function performanceSettingsEqual(
  left: PerformanceSettings,
  right: PerformanceSettings,
): boolean {
  return (
    left.muxEnabled === right.muxEnabled &&
    left.muxConcurrency === right.muxConcurrency &&
    left.xudpConcurrency === right.xudpConcurrency &&
    left.xudpProxyUDP443 === right.xudpProxyUDP443 &&
    left.xhttpMaxConnections === right.xhttpMaxConnections &&
    left.remoteDnsPreset === right.remoteDnsPreset &&
    sameStringList(left.remoteDnsServers, right.remoteDnsServers) &&
    left.tcpFastOpen === right.tcpFastOpen &&
    left.sniffingRouteOnly === right.sniffingRouteOnly &&
    left.logLevel === right.logLevel &&
    left.fingerprint === right.fingerprint &&
    left.blockAds === right.blockAds &&
    left.blockBittorrent === right.blockBittorrent &&
    left.domainStrategy === right.domainStrategy &&
    left.windowsTunRouting === right.windowsTunRouting &&
    sameStringList(left.bypassDomains, right.bypassDomains) &&
    sameStringList(left.bypassIps, right.bypassIps)
  );
}

/**
 * Pre-lean Xray defaults (TCP mux, ad/BT blocks, IPIfNonMatch).
 * Later keys (DNS, split tunnel, TUN backend) were added after this blob.
 */
export const LEGACY_PERFORMANCE_CORE = {
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
} as const;

/**
 * True when the store still has the old heavy defaults and the user did not
 * save any later field. A present later key — including an empty bypass list —
 * is treated as an explicit value and blocks migration.
 */
export function isUnmodifiedLegacyPerformanceSettings(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  for (const [key, expected] of Object.entries(LEGACY_PERFORMANCE_CORE)) {
    if (value[key] !== expected) {
      return false;
    }
  }

  if ('bypassDomains' in value || 'bypassIps' in value) {
    return false;
  }
  if ('remoteDnsPreset' in value && value.remoteDnsPreset !== 'cloudflare') {
    return false;
  }
  if ('remoteDnsServers' in value) {
    if (
      !Array.isArray(value.remoteDnsServers) ||
      !sameStringList(value.remoteDnsServers as string[], [
        '1.1.1.1',
        '1.0.0.1',
      ])
    ) {
      return false;
    }
  }
  if ('xhttpMaxConnections' in value && value.xhttpMaxConnections !== 3) {
    return false;
  }
  if (
    'windowsTunRouting' in value &&
    value.windowsTunRouting !== 'powershell'
  ) {
    return false;
  }
  return true;
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
    // Only an existing list is authoritative — an empty one means the user
    // cleared the defaults. Settings saved before split tunneling existed carry
    // no list at all and inherit the shipped exclusions.
    bypassDomains: Array.isArray(value.bypassDomains)
      ? normalizeBypassDomains(value.bypassDomains)
      : [...DEFAULT_PERFORMANCE_SETTINGS.bypassDomains],
    bypassIps: Array.isArray(value.bypassIps)
      ? normalizeBypassIps(value.bypassIps)
      : [...DEFAULT_PERFORMANCE_SETTINGS.bypassIps],
  };
}
