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
type MutableSniffing = MutableConfigNode & {
  enabled?: boolean;
  destOverride?: string[];
  routeOnly?: boolean;
};
export type MutableInbound = MutableConfigNode & {
  protocol?: string;
  tag?: string;
  port?: number;
  listen?: string;
  settings?: MutableConfigNode;
  sniffing?: MutableSniffing;
};

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

export function ensureLocalProxyInbounds(
  inbounds: MutableInbound[],
  sniffingRouteOnly = true,
  ports: { socks: number; http: number } = {
    socks: APP_CONSTANTS.PORTS.SOCKS,
    http: APP_CONSTANTS.PORTS.HTTP,
  },
): void {
  let hasSocks = false;
  let hasHttp = false;

  const ensureSniffing = (inbound: MutableInbound) => {
    if (!inbound.sniffing) {
      inbound.sniffing = createSniffing(sniffingRouteOnly);
    } else {
      inbound.sniffing.routeOnly = sniffingRouteOnly;
    }
  };

  for (const inbound of inbounds) {
    if (inbound.protocol === 'socks') {
      inbound.tag ??= 'socks';
      inbound.port = ports.socks;
      inbound.listen = '127.0.0.1';
      inbound.settings = {
        auth: 'noauth',
        ...inbound.settings,
        udp: true,
      };
      ensureSniffing(inbound);
      hasSocks = true;
    }
    if (inbound.protocol === 'http') {
      inbound.tag ??= 'http';
      inbound.port = ports.http;
      inbound.listen = '127.0.0.1';
      inbound.settings = {
        allowTransparent: false,
        ...inbound.settings,
      };
      ensureSniffing(inbound);
      hasHttp = true;
    }
  }

  if (!hasSocks || !hasHttp) {
    const defaults = createLocalProxyInbounds(sniffingRouteOnly, ports);
    if (!hasSocks) {
      inbounds.push(defaults[0] as MutableInbound);
    }
    if (!hasHttp) {
      inbounds.push(defaults[1] as MutableInbound);
    }
  }
}

export function createTunInbound(options: TunInboundOptions): XrayInbound {
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
      mtu: TUN_MTU,
      gateway: [
        `${TUN_ADDRESS}/${TUN_PREFIX}`,
        `${TUN_IPV6_ADDRESS}/${TUN_IPV6_PREFIX}`,
      ],
      dns: dnsServers,
      // Always bind Xray-originated packets (proxy + freedom/direct) to a
      // physical NIC. Without this, PowerShell TUN mode loops: geoip:private →
      // direct → default route back into TUN (NetBIOS storms).
      autoOutboundsInterface: 'auto',
    },
  };
  if (options.tunAutoRoute) {
    // Keep both defaults: browsers resolve AAAA and need ::/0 via TUN,
    // otherwise IPv6 bypasses the tunnel (or hangs) while IPv4 works in logs.
    (tunInbound.settings as MutableConfigNode).autoSystemRoutingTable = [
      '0.0.0.0/0',
      '::/0',
    ];
  }
  return tunInbound;
}
