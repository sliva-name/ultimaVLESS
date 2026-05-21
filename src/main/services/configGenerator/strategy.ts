import type { VlessConfig } from '@/shared/types';

export type ConfigBuildStrategy = 'raw' | 'structured';

export function canGenerateFromStructuredFields(config: VlessConfig): boolean {
  if (!config.address || !config.port) return false;
  if (config.protocol === 'trojan') return !!config.password;
  if (config.protocol === 'shadowsocks')
    return !!(config.method && config.password);
  return !!(config.userId || config.uuid);
}

export function selectConfigBuildStrategy(
  config: VlessConfig,
): ConfigBuildStrategy {
  if (
    config.rawConfig &&
    (config.source !== 'subscription' || !canGenerateFromStructuredFields(config))
  ) {
    return 'raw';
  }
  return 'structured';
}
