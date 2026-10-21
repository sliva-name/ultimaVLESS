import type { PerformanceSettings, RoutingMode } from '@/shared/types';
import { toXrayDomainMatcher } from '@/shared/splitTunneling';
import { isValidIpOrCidr } from '@/shared/networkAddresses';
import type { XrayRoutingRule } from '@/shared/xray-types';
import { CONNECTIVITY_TARGETS } from '../networkProbe';

/**
 * User routing rules. Xray stops at the first matching rule, so the order below
 * is the priority the settings screen documents:
 *
 *   1. service rules (stats API, DNS — added by their own builders)
 *   2. connectivity-probe pin (selective modes only)
 *   3. ad / BitTorrent blocks
 *   4. apps that always go direct
 *   5. sites and addresses — exclusions (direct) and, in `sites` mode, sites
 *      through the VPN; the more specific entry wins, a tie goes direct
 *   6. local networks (`geoip:private`) direct
 *   7. apps through the VPN (`apps` mode)
 *   8. default route: proxy in `all` mode, direct otherwise
 *
 * Site rules match the sniffed domain (SNI / Host), which is why an IP or CIDR
 * entry is the reliable option for traffic Xray cannot sniff. App rules match
 * the process that owns the connection's local socket.
 * @see https://xtls.github.io/config/routing.html
 */

type RouteTarget = 'direct' | 'proxy';

interface SiteMatcher {
  value: string;
  target: RouteTarget;
  specificity: number;
}

/** Settings persisted by an older build carry none of the routing fields. */
function list(value: readonly string[] | undefined): string[] {
  return Array.isArray(value) ? [...value] : [];
}

export function resolveRoutingMode(
  perf: Pick<PerformanceSettings, 'routingMode'>,
): RoutingMode {
  return perf.routingMode === 'sites' || perf.routingMode === 'apps'
    ? perf.routingMode
    : 'all';
}

/**
 * `geosite:` and `keyword:` cover arbitrary hosts, so they rank below every
 * concrete host; a deeper host is more specific than its parent, and `full:`
 * beats `domain:` on the same host.
 */
function domainSpecificity(entry: string): number {
  if (entry.startsWith('geosite:') || entry.startsWith('keyword:')) return 0;
  if (entry.startsWith('full:')) {
    return entry.slice('full:'.length).split('.').length * 2 + 1;
  }
  const host = entry.startsWith('domain:')
    ? entry.slice('domain:'.length)
    : entry;
  return host.split('.').length * 2;
}

/** Longer prefixes are more specific; `geoip:` lists rank last. */
function ipSpecificity(entry: string): number {
  if (entry.startsWith('geoip:')) return 0;
  const [address, prefix] = entry.split('/');
  const maxBits = address.includes(':') ? 128 : 32;
  const bits = prefix === undefined ? maxBits : Number(prefix);
  return Number.isFinite(bits) ? bits + 1 : 1;
}

/**
 * Orders exclusions and tunnelled entries so the first match is the most
 * specific one (`music.example.com` before `example.com`), then folds runs
 * with the same target into one rule each.
 */
function buildMatcherRules(
  matchers: SiteMatcher[],
  field: 'domain' | 'ip',
): XrayRoutingRule[] {
  const ordered = matchers
    .map((matcher, index) => ({ matcher, index }))
    .sort(
      (a, b) =>
        b.matcher.specificity - a.matcher.specificity ||
        // A tie goes direct: an exclusion is an explicit "never tunnel".
        (a.matcher.target === b.matcher.target
          ? 0
          : a.matcher.target === 'direct'
            ? -1
            : 1) ||
        a.index - b.index,
    )
    .map(({ matcher }) => matcher);

  const runs: Array<{ target: RouteTarget; values: string[] }> = [];
  for (const matcher of ordered) {
    const last = runs[runs.length - 1];
    if (last && last.target === matcher.target) {
      last.values.push(matcher.value);
    } else {
      runs.push({ target: matcher.target, values: [matcher.value] });
    }
  }
  return runs.map(({ target, values }) => ({
    type: 'field',
    [field]: values,
    outboundTag: target,
  }));
}

/**
 * Exclusions apply in every mode; sites through the VPN only in `sites` mode.
 * With exclusions alone the entries keep the order the user added them in.
 */
export function buildSiteRules(perf: PerformanceSettings): XrayRoutingRule[] {
  const tunnelled = resolveRoutingMode(perf) === 'sites';
  const domainMatchers: SiteMatcher[] = [
    ...list(perf.bypassDomains).map((value) => ({
      value: toXrayDomainMatcher(value),
      target: 'direct' as const,
      specificity: tunnelled ? domainSpecificity(value) : 0,
    })),
    ...(tunnelled ? list(perf.proxyDomains) : []).map((value) => ({
      value: toXrayDomainMatcher(value),
      target: 'proxy' as const,
      specificity: domainSpecificity(value),
    })),
  ];
  const ipMatchers: SiteMatcher[] = [
    ...list(perf.bypassIps).map((value) => ({
      value,
      target: 'direct' as const,
      specificity: tunnelled ? ipSpecificity(value) : 0,
    })),
    ...(tunnelled ? list(perf.proxyIps) : []).map((value) => ({
      value,
      target: 'proxy' as const,
      specificity: ipSpecificity(value),
    })),
  ];
  return [
    ...buildMatcherRules(domainMatchers, 'domain'),
    ...buildMatcherRules(ipMatchers, 'ip'),
  ];
}

export function buildPrivateBypassRule(): XrayRoutingRule {
  return { type: 'field', ip: ['geoip:private'], outboundTag: 'direct' };
}

/** Apps that skip the tunnel in every mode. */
export function buildDirectAppRules(
  perf: PerformanceSettings,
): XrayRoutingRule[] {
  const apps = list(perf.directApps);
  return apps.length > 0
    ? [{ type: 'field', process: apps, outboundTag: 'direct' }]
    : [];
}

/** Apps tunnelled in `apps` mode; everything else defaults to direct there. */
export function buildProxyAppRules(
  perf: PerformanceSettings,
): XrayRoutingRule[] {
  const apps = resolveRoutingMode(perf) === 'apps' ? list(perf.proxyApps) : [];
  return apps.length > 0
    ? [{ type: 'field', process: apps, outboundTag: 'proxy' }]
    : [];
}

/**
 * The health probes request these plain-HTTP hosts through the local proxy
 * inbound. When the default route is direct they would succeed over the
 * user's own connection and mask a dead tunnel, so they stay pinned to it.
 */
export function buildProbePinRules(
  perf: PerformanceSettings,
): XrayRoutingRule[] {
  if (resolveRoutingMode(perf) === 'all') return [];
  const domains: string[] = [];
  const ips: string[] = [];
  for (const { host } of CONNECTIVITY_TARGETS) {
    if (isValidIpOrCidr(host)) ips.push(host);
    else domains.push(`full:${host}`);
  }
  const rules: XrayRoutingRule[] = [];
  if (domains.length > 0) {
    rules.push({
      type: 'field',
      domain: domains,
      port: '80',
      outboundTag: 'proxy',
    });
  }
  if (ips.length > 0) {
    rules.push({ type: 'field', ip: ips, port: '80', outboundTag: 'proxy' });
  }
  return rules;
}

export function buildDefaultRouteRule(
  perf: PerformanceSettings,
): XrayRoutingRule {
  return {
    type: 'field',
    port: '0-65535',
    outboundTag: resolveRoutingMode(perf) === 'all' ? 'proxy' : 'direct',
  };
}

export function buildDefaultRoutingRules(
  perf: PerformanceSettings,
): XrayRoutingRule[] {
  const rules: XrayRoutingRule[] = [...buildProbePinRules(perf)];
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
  // Block rules stay ahead of the user's rules: an excluded site or a direct
  // app must not silently re-enable ad / BitTorrent traffic the user dropped.
  rules.push(...buildDirectAppRules(perf), ...buildSiteRules(perf));
  // No geosite:cn / geoip:cn bypass: the bundled geosite list falsely matches
  // global hosts (e.g. connectivitycheck.gstatic.com), sending health checks
  // to direct and breaking TUN/proxy probes for ~12s.
  rules.push(
    buildPrivateBypassRule(),
    // Behind the LAN bypass so a tunnelled app can still reach the router.
    ...buildProxyAppRules(perf),
    buildDefaultRouteRule(perf),
  );
  return rules;
}
