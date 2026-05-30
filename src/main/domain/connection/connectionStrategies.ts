import type { ConnectionMode, VlessConfig } from '@/shared/types';
import { resolveTunAutoRoute } from '@/shared/tunRouting';
import type { ConfigService } from '@/main/services/ConfigService';
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
      // System-proxy (HKCU Internet Settings) and the routing table are
      // independent subsystems, so tearing both down concurrently halves the
      // PowerShell/reg/schtasks spawn latency that dominates connect time.
      // Each service serializes its own operations internally.
      await Promise.all([
        deps.proxyService.disable(),
        deps.routeService.disable(),
      ]);
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
  configService: Pick<ConfigService, 'getPerformanceSettings'>;
}): ConnectionStrategy {
  return {
    mode: 'tun',
    async apply(server: VlessConfig): Promise<void> {
      const perf = deps.configService.getPerformanceSettings();
      const routingPlan = await deps.routeService.prepareRoutingPlan(server);
      await deps.coreService.start(server, 'tun', {
        sendThrough: routingPlan.defaultRoute.localAddress || undefined,
        tunAutoRoute: resolveTunAutoRoute(process.platform, perf),
      });
      await deps.routeService.enable(server, routingPlan);
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
