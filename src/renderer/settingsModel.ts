import type { PerformanceSettings, TlsFingerprint } from '@/shared/types';

/** Display names of the TLS fingerprints. */
export const FINGERPRINT_LABELS: Record<TlsFingerprint, string> = {
  chrome: 'Chrome',
  firefox: 'Firefox',
  safari: 'Safari',
  ios: 'iOS',
  android: 'Android',
  edge: 'Edge',
  '360': '360',
  qq: 'QQ',
  random: 'Random',
  randomized: 'Randomized',
};

/** Fields the "Xray core" page shows and resets. */
export const CORE_FIELDS = [
  'muxEnabled',
  'muxConcurrency',
  'xhttpMaxConnections',
  'xudpConcurrency',
  'xudpProxyUDP443',
  'tunMtu',
  'tcpFastOpen',
  'sniffingRouteOnly',
  'domainStrategy',
  'fingerprint',
  'logLevel',
] as const satisfies readonly (keyof PerformanceSettings)[];

/** Fields edited together, counted as one change. */
const LINKED_FIELDS: (keyof PerformanceSettings)[][] = [
  ['remoteDnsPreset', 'remoteDnsServers'],
  ['bypassDomains', 'bypassIps'],
  ['proxyDomains', 'proxyIps'],
];

/** How many settings differ from the stored ones. */
export function countChanges(
  edited: PerformanceSettings,
  stored: PerformanceSettings,
): number {
  const differs = (key: keyof PerformanceSettings) =>
    JSON.stringify(edited[key]) !== JSON.stringify(stored[key]);
  const linked = new Set(LINKED_FIELDS.flat());
  const single = (Object.keys(edited) as (keyof PerformanceSettings)[]).filter(
    (key) => !linked.has(key) && differs(key),
  ).length;
  return single + LINKED_FIELDS.filter((group) => group.some(differs)).length;
}
