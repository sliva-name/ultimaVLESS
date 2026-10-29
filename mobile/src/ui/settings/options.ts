import type { TFunction } from 'i18next';
import type { PerformanceSettings } from '@/shared/types';
import { FINGERPRINT_LABELS } from '@/renderer/settingsModel';
import type { SelectOption } from './kit';

export { countChanges, FINGERPRINT_LABELS } from '@/renderer/settingsModel';

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
