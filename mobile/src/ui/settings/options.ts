import type { TFunction } from 'i18next';
import type { PerformanceSettings, TlsFingerprint } from '@/shared/types';
import type { SelectOption } from './kit';

/** Same names as the desktop fingerprint picker. */
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

export const FINGERPRINT_OPTIONS: SelectOption[] = Object.entries(
  FINGERPRINT_LABELS,
).map(([value, label]) => ({ value, label }));

export const DOMAIN_STRATEGY_OPTIONS: SelectOption[] = [
  'AsIs',
  'IPIfNonMatch',
  'IPOnDemand',
].map((value) => ({ value, label: value }));

export const LOG_LEVEL_OPTIONS: SelectOption[] = [
  'debug',
  'info',
  'warning',
  'error',
  'none',
].map((value) => ({ value, label: value }));

export function udp443Options(t: TFunction): SelectOption[] {
  return [
    { value: 'reject', label: t('settings.network.udp443Reject') },
    { value: 'allow', label: t('settings.network.udp443Allow') },
    { value: 'skip', label: t('settings.network.udp443Skip') },
  ];
}

/** Fields the "Xray core" screen shows and resets. */
export const CORE_FIELDS = [
  'muxEnabled',
  'muxConcurrency',
  'xhttpMaxConnections',
  'xudpConcurrency',
  'xudpProxyUDP443',
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
