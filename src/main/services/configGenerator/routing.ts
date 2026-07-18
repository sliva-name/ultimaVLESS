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
  // No geosite:cn / geoip:cn bypass: the bundled geosite list falsely matches
  // global hosts (e.g. connectivitycheck.gstatic.com), sending health checks
  // to direct and breaking TUN/proxy probes for ~12s.
  rules.push(
    {
      type: 'field',
      ip: ['geoip:private'],
      outboundTag: 'direct',
    },
    { type: 'field', port: '0-65535', outboundTag: 'proxy' },
  );
  return rules;
}
