type Node = Record<string, unknown>;

export const PROXY_TAG = 'proxy';

const TUNNEL_PROTOCOLS = new Set([
  'vless',
  'vmess',
  'trojan',
  'shadowsocks',
  'hysteria',
  'wireguard',
]);

function asNode(value: unknown): Node | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Node)
    : null;
}

/**
 * The outbound a raw config tunnels through: the one tagged `proxy`, else the
 * first outbound with a tunnel protocol.
 */
export function findRawProxyOutbound(outbounds: unknown): Node | undefined {
  if (!Array.isArray(outbounds)) return undefined;
  const nodes = outbounds.map(asNode).filter((node): node is Node => !!node);
  return (
    nodes.find((node) => node.tag === PROXY_TAG) ??
    nodes.find((node) => TUNNEL_PROTOCOLS.has(String(node.protocol)))
  );
}

/**
 * Generated routing, the DNS pin and the traffic counters all address the
 * outbound tagged `proxy`. Subscriptions also export the tunnel under other
 * tags (`vless-reality`, …); that outbound is renamed, references included.
 */
export function adoptProxyOutboundTag(cfg: Node): void {
  const outbounds = Array.isArray(cfg.outbounds) ? cfg.outbounds : [];
  if (outbounds.some((outbound) => asNode(outbound)?.tag === PROXY_TAG)) {
    return;
  }
  const chosen = findRawProxyOutbound(outbounds);
  if (!chosen) return;
  const previous = typeof chosen.tag === 'string' ? chosen.tag : '';
  chosen.tag = PROXY_TAG;
  if (!previous) return;

  const routing = asNode(cfg.routing);
  for (const rule of Array.isArray(routing?.rules) ? routing.rules : []) {
    const node = asNode(rule);
    if (node?.outboundTag === previous) node.outboundTag = PROXY_TAG;
  }
  for (const balancer of Array.isArray(routing?.balancers)
    ? routing.balancers
    : []) {
    const node = asNode(balancer);
    if (node?.fallbackTag === previous) node.fallbackTag = PROXY_TAG;
  }
  for (const outbound of outbounds) {
    const node = asNode(outbound);
    const sockopt = asNode(asNode(node?.streamSettings)?.sockopt);
    if (sockopt?.dialerProxy === previous) sockopt.dialerProxy = PROXY_TAG;
    const proxySettings = asNode(node?.proxySettings);
    if (proxySettings?.tag === previous) proxySettings.tag = PROXY_TAG;
  }
}
