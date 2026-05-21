import type { PerformanceSettings } from '@/shared/types';
import type { XrayRoutingRule } from '@/shared/xray-types';

export function buildDefaultRoutingRules(
  perf: PerformanceSettings,
): XrayRoutingRule[] {
  const rules: XrayRoutingRule[] = [];
  if (perf.blockAds) {
    rules.push({
      type: 'field',
      domain: ['geosite:category-ads-all'],
      outboundTag: 'block',
    });
  }
  if (perf.blockBittorrent) {
    rules.push({
      type: 'field',
      protocol: ['bittorrent'],
      outboundTag: 'block',
    });
  }
  rules.push(
    { type: 'field', domain: ['geosite:cn'], outboundTag: 'direct' },
    {
      type: 'field',
      ip: ['geoip:private', 'geoip:cn'],
      outboundTag: 'direct',
    },
    { type: 'field', port: '0-65535', outboundTag: 'proxy' },
  );
  return rules;
}
