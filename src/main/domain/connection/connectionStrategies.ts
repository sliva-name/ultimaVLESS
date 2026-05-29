import type { ConnectionMode, VlessConfig } from '@/shared/types';
import type { SystemProxyService } from '@/main/services/SystemProxyService';
import type { TunRouteService } from '@/main/services/TunRouteService';
import type { XrayService } from '@/main/services/XrayService';

export interface ProxyPorts {
  http: number;
  socks: number;
}

export interface NetworkTeardown {
  reset: (options?: { stopXray?: boolean }) => Promise<void>;
}

export interface ConnectionStrategy {
  mode: ConnectionMode;
  apply: (server: VlessConfig, ports: ProxyPorts) => Promise<void>;
}

export function createNetworkTeardown(deps: {
  proxyService: SystemProxyService;
  routeService: TunRouteService;
  coreService: XrayService;
}): NetworkTeardown {
  return {
    async reset(options: { stopXray?: boolean } = {}): Promise<void> {
      const { stopXray = true } = options;
      await deps.proxyService.disable();
      await deps.routeService.disable();
      if (stopXray) {
        deps.coreService.stop();
      }
    },
  };
}

export function createProxyConnectionStrategy(deps: {
  proxyService: SystemProxyService;
  coreService: XrayService;
}): ConnectionStrategy {
  return {
    mode: 'proxy',
    async apply(server: VlessConfig, ports: ProxyPorts): Promise<void> {
      await deps.coreService.start(server, 'proxy');
      await deps.proxyService.enable(ports.http, ports.socks);
    },
  };
}

export function createTunConnectionStrategy(deps: {
  routeService: TunRouteService;
  coreService: XrayService;
}): ConnectionStrategy {
  return {
    mode: 'tun',
    async apply(server: VlessConfig): Promise<void> {
      const routingPlan = await deps.routeService.prepareRoutingPlan(server);
      await deps.coreService.start(server, 'tun', {
        sendThrough: routingPlan.defaultRoute.localAddress || undefined,
        tunAutoRoute: process.platform !== 'win32',
      });
      await deps.routeService.enable(server, routingPlan);
    },
  };
}

export function createConnectionStrategies(deps: {
  proxyService: SystemProxyService;
  routeService: TunRouteService;
  coreService: XrayService;
}): Record<ConnectionMode, ConnectionStrategy> {
  return {
    proxy: createProxyConnectionStrategy(deps),
    tun: createTunConnectionStrategy(deps),
  };
}
