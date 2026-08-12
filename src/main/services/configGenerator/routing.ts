import type { PerformanceSettings } from '@/shared/types';
import { toXrayDomainMatcher } from '@/shared/splitTunneling';
import type { XrayRoutingRule } from '@/shared/xray-types';

/**
 * Split tunneling rules. They must precede the catch-all `proxy` rule, and are
 * matched on the sniffed domain (SNI / Host) for domain entries, which is why an
 * IP or CIDR entry is the reliable option for traffic Xray cannot sniff.
 * @see https://xtls.github.io/config/routing.html
 */
export function buildBypassRules(
  perf: PerformanceSettings,
): XrayRoutingRule[] {
  const rules: XrayRoutingRule[] = [];
  // Settings persisted by an older build carry no split tunneling fields.
  const domains = Array.isArray(perf.bypassDomains) ? perf.bypassDomains : [];
  const ips = Array.isArray(perf.bypassIps) ? perf.bypassIps : [];
  if (domains.length > 0) {
    rules.push({
      type: 'field',
      domain: domains.map(toXrayDomainMatcher),
      outboundTag: 'direct',
    });
  }
  if (ips.length > 0) {
    rules.push({
      type: 'field',
      ip: [...ips],
      outboundTag: 'direct',
    });
  }
  return rules;
}

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
  // Block rules stay ahead of the user's bypass list: an excluded site must not
  // silently re-enable ad / BitTorrent traffic the user chose to drop.
  rules.push(...buildBypassRules(perf));
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
