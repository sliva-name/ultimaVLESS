import { APP_CONSTANTS } from '@/shared/constants';
import type { XrayInbound } from '@/shared/xray-types';
import {
  TUN_ADDRESS,
  TUN_DNS_SERVERS,
  TUN_INTERFACE_NAME,
  TUN_IPV6_ADDRESS,
  TUN_IPV6_PREFIX,
  TUN_PREFIX,
} from '../tunRoute/constants';

interface TunInboundOptions {
  tunAutoRoute?: boolean;
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
): XrayInbound[] {
  const sniffing = {
    enabled: true,
    destOverride: ['http', 'tls', 'quic'],
    routeOnly: sniffingRouteOnly,
  };
  return [
    {
      tag: 'socks',
      port: APP_CONSTANTS.PORTS.SOCKS,
      listen: '127.0.0.1',
      protocol: 'socks',
      settings: { udp: true },
      sniffing,
    },
    {
      tag: 'http',
      port: APP_CONSTANTS.PORTS.HTTP,
      listen: '127.0.0.1',
      protocol: 'http',
      settings: {},
      sniffing,
    },
  ];
}

export function ensureLocalProxyInbounds(
  inbounds: MutableInbound[],
  sniffingRouteOnly = true,
): void {
  let hasSocks = false;
  let hasHttp = false;

  const ensureSniffing = (inbound: MutableInbound) => {
    if (!inbound.sniffing) {
      inbound.sniffing = {
        enabled: true,
        destOverride: ['http', 'tls', 'quic'],
        routeOnly: sniffingRouteOnly,
      };
    } else {
      inbound.sniffing.routeOnly = sniffingRouteOnly;
    }
  };

  for (const inbound of inbounds) {
    if (inbound.protocol === 'socks') {
      inbound.tag ??= 'socks';
      inbound.port = APP_CONSTANTS.PORTS.SOCKS;
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
      inbound.port = APP_CONSTANTS.PORTS.HTTP;
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
    const defaults = createLocalProxyInbounds(sniffingRouteOnly);
    if (!hasSocks) {
      inbounds.push(defaults[0] as MutableInbound);
    }
    if (!hasHttp) {
      inbounds.push(defaults[1] as MutableInbound);
    }
  }
}

export function createTunInbound(options: TunInboundOptions): XrayInbound {
  const tunInbound: XrayInbound = {
    tag: 'tun-in',
    port: 0,
    protocol: 'tun',
    settings: {
      name: TUN_INTERFACE_NAME,
      mtu: 1500,
      gateway: [
        `${TUN_ADDRESS}/${TUN_PREFIX}`,
        `${TUN_IPV6_ADDRESS}/${TUN_IPV6_PREFIX}`,
      ],
      dns: TUN_DNS_SERVERS,
    },
  };
  if (options.tunAutoRoute) {
    (tunInbound.settings as MutableConfigNode).autoSystemRoutingTable = [
      '0.0.0.0/0',
      '::/0',
    ];
    (tunInbound.settings as MutableConfigNode).autoOutboundsInterface = 'auto';
  }
  return tunInbound;
}
