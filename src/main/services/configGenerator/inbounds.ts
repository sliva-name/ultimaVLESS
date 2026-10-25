import { APP_CONSTANTS } from '@/shared/constants';
import type { XrayInbound } from '@/shared/xray-types';
import {
  TUN_ADDRESS,
  TUN_DNS_SERVERS,
  TUN_INTERFACE_NAME,
  TUN_IPV6_ADDRESS,
  TUN_IPV6_PREFIX,
  TUN_MTU,
  TUN_PREFIX,
} from '../tunRoute/constants';

interface TunInboundOptions {
  tunAutoRoute?: boolean;
  /** DNS servers advertised on the TUN interface (Windows). */
  dnsServers?: string[];
  sniffingRouteOnly?: boolean;
  /** Advertised TUN MTU; falls back to TUN_MTU when omitted. */
  mtu?: number;
  /** Adapter alias Xray binds its own sockets to; `auto` when omitted. */
  outboundInterface?: string;
  /** Windows: WFP filters keep other programs' DNS inside the TUN. */
  blockDnsLeaks?: boolean;
  /** False when the system cannot give the TUN an IPv6 address (Linux). */
  ipv6?: boolean;
  /**
   * Linux: route the two halves of the address space instead of the default
   * route. Xray adds its routes with metric 1, which loses to a default route
   * with metric 0, and a more specific prefix wins whatever the metrics. Xray
   * keeps finding the physical interface by its own `/0` route.
   */
  splitDefaultRoute?: boolean;
}

/**
 * Sniffing must be enabled on every inbound that feeds routing, including
 * `tun-in`: without it routing only sees IP:port, so domain rules (ad blocking,
 * any `geosite:` rule) can never match under `domainStrategy: AsIs`.
 * `quic` is required because browsers emit QUIC over TUN.
 * @see https://xtls.github.io/config/inbounds/tun.html
 */
export function createSniffing(routeOnly: boolean): {
  enabled: boolean;
  destOverride: string[];
  routeOnly: boolean;
} {
  return {
    enabled: true,
    destOverride: ['http', 'tls', 'quic'],
    routeOnly,
  };
}

type MutableConfigNode = Record<string, unknown>;

export function createLocalProxyInbounds(
  sniffingRouteOnly = true,
  ports: { socks: number; http: number } = {
    socks: APP_CONSTANTS.PORTS.SOCKS,
    http: APP_CONSTANTS.PORTS.HTTP,
  },
): XrayInbound[] {
  return [
    {
      tag: 'socks',
      port: ports.socks,
      listen: '127.0.0.1',
      protocol: 'socks',
      settings: { udp: true },
      sniffing: createSniffing(sniffingRouteOnly),
    },
    {
      tag: 'http',
      port: ports.http,
      listen: '127.0.0.1',
      protocol: 'http',
      settings: {},
      sniffing: createSniffing(sniffingRouteOnly),
    },
  ];
}

export function createTunInbound(options: TunInboundOptions): XrayInbound {
  const ipv6 = options.ipv6 !== false;
  const dnsServers =
    options.dnsServers && options.dnsServers.length > 0
      ? options.dnsServers
      : TUN_DNS_SERVERS;
  const tunInbound: XrayInbound = {
    tag: 'tun-in',
    port: 0,
    protocol: 'tun',
    sniffing: createSniffing(options.sniffingRouteOnly ?? true),
    settings: {
      name: TUN_INTERFACE_NAME,
      mtu: options.mtu ?? TUN_MTU,
      gateway: [
        `${TUN_ADDRESS}/${TUN_PREFIX}`,
        ...(ipv6 ? [`${TUN_IPV6_ADDRESS}/${TUN_IPV6_PREFIX}`] : []),
      ],
      dns: dnsServers,
      // Always bind Xray-originated packets (proxy + freedom/direct) to a
      // physical NIC. Without this, PowerShell TUN mode loops: geoip:private →
      // direct → default route back into TUN (NetBIOS storms). An explicit
      // adapter (Windows) overrides Xray's name-based guess.
      autoOutboundsInterface: options.outboundInterface || 'auto',
    },
  };
  if (options.tunAutoRoute) {
    // Keep both defaults: browsers resolve AAAA and need ::/0 via TUN,
    // otherwise IPv6 bypasses the tunnel (or hangs) while IPv4 works in logs.
    const split = options.splitDefaultRoute === true;
    (tunInbound.settings as MutableConfigNode).autoSystemRoutingTable = [
      ...(split ? ['0.0.0.0/1', '128.0.0.0/1'] : ['0.0.0.0/0']),
      ...(ipv6 ? (split ? ['::/1', '8000::/1'] : ['::/0']) : []),
    ];
    // Windows otherwise also queries the other adapters' DNS servers (Smart
    // Multi-Homed Name Resolution), and a DHCP resolver on the LAN wins by its
    // more specific route. Xray rejects this without autoSystemRoutingTable.
    // @see https://github.com/XTLS/Xray-core/blob/main/proxy/tun/README.md#windows-support
    if (options.blockDnsLeaks) {
      (tunInbound.settings as MutableConfigNode).autoSystemWfpBlockLeak = [
        'dns',
      ];
    }
  }
  return tunInbound;
}
