import type { PerformanceSettings } from '@/shared/types';
import type { XrayConfig, XrayRoutingRule } from '@/shared/xray-types';

export const DNS_OUTBOUND_TAG = 'dns-out';

type MutableConfigNode = Record<string, unknown>;
type MutableOutbound = MutableConfigNode & {
  protocol?: string;
  tag?: string;
  settings?: MutableConfigNode;
};

export function buildDnsObject(
  perf: PerformanceSettings,
): Record<string, unknown> {
  const servers =
    perf.remoteDnsServers.length > 0
      ? [...perf.remoteDnsServers]
      : ['1.1.1.1', '1.0.0.1'];
  return {
    servers,
    queryStrategy: 'UseIPv4',
  };
}

/**
 * DNS outbound that hijacks A/AAAA into the built-in DNS module (remote servers
 * via routing) and rewrites other queries to the primary remote resolver.
 * @see https://xtls.github.io/en/config/outbounds/dns.html
 */
export function ensureDnsOutbound(
  cfg: XrayConfig,
  primaryDnsIp: string,
): void {
  if (!Array.isArray(cfg.outbounds)) cfg.outbounds = [];
  const outbounds = cfg.outbounds as MutableOutbound[];
  const settings = {
    rewriteNetwork: 'udp',
    rewriteAddress: primaryDnsIp,
    rewritePort: 53,
    rules: [
      { action: 'hijack', qType: '1,28' },
      { action: 'direct' },
    ],
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

  // After API inbound rule if present; otherwise at the front.
  const apiIdx = rules.findIndex(
    (r) => Array.isArray(r.inboundTag) && r.inboundTag.includes('api'),
  );
  const insertAt = apiIdx >= 0 ? apiIdx + 1 : 0;
  rules.splice(insertAt, 0, dnsRule);
}

export function applyRemoteDnsSettings(
  cfg: XrayConfig,
  perf: PerformanceSettings,
  options: { tunMode: boolean },
): void {
  const dnsObject = buildDnsObject(perf);
  const existing =
    cfg.dns && typeof cfg.dns === 'object'
      ? (cfg.dns as Record<string, unknown>)
      : {};
  cfg.dns = {
    ...existing,
    ...dnsObject,
  };

  if (!options.tunMode) return;

  const servers = dnsObject.servers as string[];
  syncTunInboundDns(cfg, servers);
  ensureDnsOutbound(cfg, servers[0] ?? '1.1.1.1');

  if (!cfg.routing || typeof cfg.routing !== 'object') {
    cfg.routing = { domainStrategy: 'AsIs', rules: [] };
  }
  if (!Array.isArray(cfg.routing.rules)) {
    cfg.routing.rules = [];
  }
  ensureDnsHijackRule(cfg.routing.rules as XrayRoutingRule[]);
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
