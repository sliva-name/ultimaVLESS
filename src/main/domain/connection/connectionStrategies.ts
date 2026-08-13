import type { ConnectionMode, VlessConfig } from '@/shared/types';
import type { ConfigService } from '@/main/services/ConfigService';
import type { SystemProxyService } from '@/main/services/SystemProxyService';
import type { TunRouteService } from '@/main/services/TunRouteService';
import type { XrayService } from '@/main/services/XrayService';
import {
  createProxyNetworkRuntime,
  createTunNetworkRuntime,
} from './NetworkModeRuntime';

export interface ProxyPorts {
  http: number;
  socks: number;
}

export interface NetworkTeardown {
  reset: (options?: {
    stopXray?: boolean;
    /**
     * Runtime-internal: ConnectionRuntime.switch() keeps the proxy path itself.
     * Control-plane code must not pass this flag.
     */
    keepSystemProxy?: boolean;
  }) => Promise<void>;
}

export interface ConnectionStrategy {
  mode: ConnectionMode;
  apply: (server: VlessConfig, ports: ProxyPorts) => Promise<void>;
}

export function createNetworkTeardown(deps: {
  proxyService: Pick<SystemProxyService, 'disable'>;
  routeService: Pick<TunRouteService, 'disable'>;
  coreService: Pick<XrayService, 'stop'>;
}): NetworkTeardown {
  return {
    async reset(
      options: { stopXray?: boolean; keepSystemProxy?: boolean } = {},
    ): Promise<void> {
      const { stopXray = true, keepSystemProxy = false } = options;
      const teardownTasks: Array<Promise<void>> = [deps.routeService.disable()];
      if (!keepSystemProxy) {
        teardownTasks.push(deps.proxyService.disable());
      }
      await Promise.all(teardownTasks);
      if (stopXray) {
        deps.coreService.stop();
      }
    },
  };
}

export function createProxyConnectionStrategy(deps: {
  proxyService: Pick<SystemProxyService, 'enable' | 'disable'>;
  coreService: Pick<XrayService, 'start'>;
}): ConnectionStrategy {
  const network = createProxyNetworkRuntime(deps.proxyService);
  return {
    mode: 'proxy',
    async apply(server: VlessConfig, ports: ProxyPorts): Promise<void> {
      const prepared = await network.prepare({
        server,
        mode: 'proxy',
        ports,
      });
      await deps.coreService.start(prepared.server, 'proxy', prepared.xrayOptions);
      await network.activate(prepared);
    },
  };
}

export function createTunConnectionStrategy(deps: {
  routeService: Pick<
    TunRouteService,
    'prepareRoutingPlan' | 'pinProxyHostRoutes' | 'enable' | 'disable'
  >;
  coreService: Pick<XrayService, 'start'>;
  configService: Pick<ConfigService, 'getPerformanceSettings'>;
}): ConnectionStrategy {
  const network = createTunNetworkRuntime(deps.routeService, deps.configService);
  return {
    mode: 'tun',
    async apply(server: VlessConfig, ports: ProxyPorts): Promise<void> {
      const prepared = await network.prepare({
        server,
        mode: 'tun',
        ports,
      });
      await deps.coreService.start(prepared.server, 'tun', prepared.xrayOptions);
      await network.activate(prepared);
    },
  };
}

export function createConnectionStrategies(deps: {
  proxyService: SystemProxyService;
  routeService: TunRouteService;
  coreService: XrayService;
  configService: Pick<ConfigService, 'getPerformanceSettings'>;
}): Record<ConnectionMode, ConnectionStrategy> {
  return {
    proxy: createProxyConnectionStrategy(deps),
    tun: createTunConnectionStrategy(deps),
  };
}
