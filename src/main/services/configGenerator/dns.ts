import type { PerformanceSettings } from '@/shared/types';
import type { XrayConfig, XrayRoutingRule } from '@/shared/xray-types';

export const DNS_OUTBOUND_TAG = 'dns-out';
/**
 * Tags traffic the built-in DNS module originates, so routing can pin it to the
 * proxy outbound via `inboundTag`. Without this the module's upstream queries
 * follow generic rules and can fall through to `direct`.
 * @see https://xtls.github.io/config/dns.html
 */
export const DNS_MODULE_TAG = 'dns-module';
export const PROXY_OUTBOUND_TAG = 'proxy';

type MutableConfigNode = Record<string, unknown>;
type MutableOutbound = MutableConfigNode & {
  protocol?: string;
  tag?: string;
  settings?: MutableConfigNode;
};

export function buildDnsObject(
  perf: PerformanceSettings,
  _options: { tunMode?: boolean } = {},
): Record<string, unknown> {
  const servers =
    perf.remoteDnsServers.length > 0
      ? [...perf.remoteDnsServers]
      : ['1.1.1.1', '1.0.0.1'];
  return {
    servers,
    // Always IPv4. Proxy has no IPv6 path. TUN still routes `::/0` for apps
    // that already hold an IPv6 literal, but `UseSystem`/`UseIP` lets Windows
    // chase AAAA first (~10–12s) while health probes go through the local HTTP
    // proxy and stay green. Slow servers make that hang look like “TUN is
    // dead” even though the same node works in proxy mode.
    queryStrategy: 'UseIPv4',
    tag: DNS_MODULE_TAG,
    // Without this, a failed remote resolver falls through to later entries —
    // including any `localhost` a subscription might have injected before we
    // started replacing the dns object wholesale.
    disableFallback: true,
  };
}

/**
 * DNS outbound that hijacks A/AAAA into the built-in DNS module (remote servers
 * via routing) and rewrites other queries to the primary remote resolver.
 * @see https://xtls.github.io/en/config/outbounds/dns.html
 */
export function ensureDnsOutbound(cfg: XrayConfig, primaryDnsIp: string): void {
  if (!Array.isArray(cfg.outbounds)) cfg.outbounds = [];
  const outbounds = cfg.outbounds as MutableOutbound[];
  // `action: 'hijack'` without a qType filter routes *every* query type into the
  // built-in resolver. A trailing `{ action: 'direct' }` would instead let all
  // non-A/AAAA types (notably qType 65 HTTPS/SVCB, which browsers request for
  // nearly every navigation) leave as plaintext DNS carrying the hostname.
  // @see https://xtls.github.io/config/outbounds/dns.html
  const settings = {
    rewriteNetwork: 'udp',
    rewriteAddress: primaryDnsIp,
    rewritePort: 53,
    rules: [{ action: 'hijack' }],
  };

  const existing = outbounds.find((o) => o?.tag === DNS_OUTBOUND_TAG);
  if (existing) {
    existing.protocol = 'dns';
    existing.settings = settings;
    return;
  }

  // Keep proxy first; insert dns-out before freedom/blackhole auxiliaries.
  const insertAt = Math.max(
    1,
    outbounds.findIndex((o) => o?.tag === 'direct'),
  );
  const index = insertAt === -1 ? outbounds.length : insertAt;
  outbounds.splice(index, 0, {
    tag: DNS_OUTBOUND_TAG,
    protocol: 'dns',
    settings,
  });
}

/** Route OS DNS (TUN) to dns-out before private/catch-all rules. */
export function ensureDnsHijackRule(rules: XrayRoutingRule[]): void {
  const isDnsHijack = (rule: XrayRoutingRule | undefined): boolean =>
    !!rule &&
    rule.outboundTag === DNS_OUTBOUND_TAG &&
    String(rule.port) === '53';

  const withoutOld = rules.filter((rule) => !isDnsHijack(rule));
  rules.length = 0;
  rules.push(...withoutOld);

  const dnsRule: XrayRoutingRule = {
    type: 'field',
    port: '53',
    network: 'udp,tcp',
    outboundTag: DNS_OUTBOUND_TAG,
  };

  rules.splice(dnsRuleInsertIndex(rules), 0, dnsRule);
}

/**
 * Pins queries originating from the built-in DNS module to the proxy outbound.
 * Must sit ahead of the port-53 hijack rule, otherwise the module's own upstream
 * query would match `port: 53` and be fed back into itself.
 */
export function ensureDnsModulePinnedToProxy(
  cfg: XrayConfig,
  rules: XrayRoutingRule[],
): void {
  const hasProxyOutbound =
    Array.isArray(cfg.outbounds) &&
    cfg.outbounds.some((o) => o?.tag === PROXY_OUTBOUND_TAG);
  if (!hasProxyOutbound) return;

  const isPin = (rule: XrayRoutingRule | undefined): boolean =>
    !!rule &&
    Array.isArray(rule.inboundTag) &&
    rule.inboundTag.includes(DNS_MODULE_TAG);

  const withoutOld = rules.filter((rule) => !isPin(rule));
  rules.length = 0;
  rules.push(...withoutOld);

  rules.splice(dnsRuleInsertIndex(rules), 0, {
    type: 'field',
    inboundTag: [DNS_MODULE_TAG],
    outboundTag: PROXY_OUTBOUND_TAG,
  });
}

/** After the API inbound rule if present; otherwise at the front. */
function dnsRuleInsertIndex(rules: XrayRoutingRule[]): number {
  const apiIdx = rules.findIndex(
    (r) => Array.isArray(r.inboundTag) && r.inboundTag.includes('api'),
  );
  return apiIdx >= 0 ? apiIdx + 1 : 0;
}

export function applyRemoteDnsSettings(
  cfg: XrayConfig,
  perf: PerformanceSettings,
  options: { tunMode: boolean },
): void {
  // Replaced, not merged: a subscription-supplied `dns` object can pin arbitrary
  // `hosts` (domain -> attacker-controlled IP) or append servers that resolve
  // outside the tunnel.
  const dnsObject = buildDnsObject(perf, { tunMode: options.tunMode });
  cfg.dns = dnsObject;

  if (!cfg.routing || typeof cfg.routing !== 'object') {
    cfg.routing = { domainStrategy: perf.domainStrategy, rules: [] };
  }
  if (!Array.isArray(cfg.routing.rules)) {
    cfg.routing.rules = [];
  }
  const rules = cfg.routing.rules as XrayRoutingRule[];

  if (options.tunMode) {
    const servers = dnsObject.servers as string[];
    syncTunInboundDns(cfg, servers);
    ensureDnsOutbound(cfg, servers[0] ?? '1.1.1.1');
    ensureDnsHijackRule(rules);
  }

  ensureDnsModulePinnedToProxy(cfg, rules);
}

function syncTunInboundDns(cfg: XrayConfig, servers: string[]): void {
  if (!Array.isArray(cfg.inbounds) || servers.length === 0) return;
  for (const inbound of cfg.inbounds) {
    if (!inbound || (inbound.protocol !== 'tun' && inbound.tag !== 'tun-in')) {
      continue;
    }
    const settings =
      inbound.settings && typeof inbound.settings === 'object'
        ? { ...inbound.settings }
        : {};
    settings.dns = [...servers];
    inbound.settings = settings;
  }
}
