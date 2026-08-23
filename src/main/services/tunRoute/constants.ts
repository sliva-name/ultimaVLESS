export const TUN_INTERFACE_NAME = 'ultima0';
export const TUN_ADDRESS = '172.19.0.1';
export const TUN_PREFIX = 30;
export const TUN_NEXTHOP = '172.19.0.2';
export const TUN_IPV6_ADDRESS = 'fd7a:115c:a1e0::1';
export const TUN_IPV6_PREFIX = 126;
export const TUN_IPV6_NEXTHOP = '::';
/**
 * TUN advertised MTU. Ethernet is 1500, but VLESS/REALITY/TLS headers sit on
 * top of every packet. At 1500, apps emit full-size frames that fragment on
 * the physical NIC; slow/lossy servers drop those fragments and TCP stalls.
 * Proxy mode never sees this (HTTP CONNECT is stream-framed). WireGuard in
 * this codebase uses 1350; 1400 is the usual TLS-VPN compromise.
 */
export const TUN_MTU = 1400;
/** IPv4-only: advertising IPv6 resolvers makes Windows prefer AAAA DNS first
 * (~2s timeout each) before falling back to 1.1.1.1 — often ~10–12s until
 * the first useful browser TCP after TUN connect. Fallback matches Cloudflare
 * remote DNS default when performance settings are unavailable. */
export const TUN_DNS_SERVERS = ['1.1.1.1', '1.0.0.1'];
export const TUN_ROUTE_METRIC = 1;
export const TUN_WAIT_TIMEOUT = 20000;
export const TUN_WAIT_INTERVAL = 300;
export const POWERSHELL_TIMEOUT = 30000;
export const STALE_ROUTE_CLEANUP_TIMEOUT = 5000;
/** Public-resolver fallback after system DNS; keep short so connect UI stays snappy. */
export const DNS_TIMEOUT = 3000;
export const SYSTEM_DNS_TIMEOUT = 1500;
export const ENABLE_TIMEOUT = 60000;
export const DEFAULT_ROUTE_WAIT_TIMEOUT = 12000;
export const DEFAULT_ROUTE_WAIT_INTERVAL = 500;
export const DEFAULT_ROUTE_STABLE_HITS = 2;
export const DEFAULT_ROUTE_ADD_RETRIES = 3;
export const DEFAULT_ROUTE_ADD_RETRY_DELAY_MS = 400;
export const UNIX_COMMAND_TIMEOUT = 10000;

export interface DefaultRouteInfo {
  gateway: string;
  interfaceIndex: number;
  interfaceName: string;
  localAddress: string | null;
}
