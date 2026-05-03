export const TUN_INTERFACE_NAME = 'ultima0';
export const TUN_ADDRESS = '172.19.0.1';
export const TUN_PREFIX = 30;
export const TUN_NEXTHOP = '172.19.0.2';
export const TUN_IPV6_ADDRESS = 'fd7a:115c:a1e0::1';
export const TUN_IPV6_PREFIX = 126;
export const TUN_IPV6_NEXTHOP = '::';
export const TUN_DNS_SERVERS = [
  '1.1.1.1',
  '8.8.8.8',
  '2606:4700:4700::1111',
  '2001:4860:4860::8888',
];
export const TUN_ROUTE_METRIC = 1;
export const TUN_WAIT_TIMEOUT = 20000;
export const TUN_WAIT_INTERVAL = 300;
export const POWERSHELL_TIMEOUT = 30000;
export const DNS_TIMEOUT = 8000;
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
