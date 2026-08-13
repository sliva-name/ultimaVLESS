import type { ConnectionMode, VlessConfig } from '@/shared/types';
import { resolveTunAutoRoute } from '@/shared/tunRouting';
import type { ConfigService } from '@/main/services/ConfigService';
import type { SystemProxyService } from '@/main/services/SystemProxyService';
import type {
  TunRouteService,
  TunRoutingPlan,
} from '@/main/services/TunRouteService';
import type { XrayStartOptions } from '@/main/services/XrayService';
import { bindProxyEndpointToIp } from './bindProxyEndpoint';
import type { ConnectionSpec } from './ConnectionSpec';

export interface PreparedConnection {
  spec: ConnectionSpec;
  server: VlessConfig;
  xrayOptions?: XrayStartOptions;
  routingPlan?: TunRoutingPlan;
}

export interface NetworkModeRuntime {
  readonly mode: ConnectionMode;
  prepare(spec: ConnectionSpec): Promise<PreparedConnection>;
  activate(prepared: PreparedConnection): Promise<void>;
  deactivate(): Promise<void>;
}

export function createProxyNetworkRuntime(
  proxyService: Pick<SystemProxyService, 'enable' | 'disable'>,
): NetworkModeRuntime {
  return {
    mode: 'proxy',
    async prepare(spec: ConnectionSpec): Promise<PreparedConnection> {
      return { spec, server: spec.server };
    },
    async activate(prepared: PreparedConnection): Promise<void> {
      await proxyService.enable(prepared.spec.ports.http, prepared.spec.ports.socks);
    },
    async deactivate(): Promise<void> {
      await proxyService.disable();
    },
  };
}

export function createTunNetworkRuntime(
  routeService: Pick<
    TunRouteService,
    | 'prepareRoutingPlan'
    | 'pinProxyHostRoutes'
    | 'enable'
    | 'disable'
  >,
  configService: Pick<ConfigService, 'getPerformanceSettings'>,
): NetworkModeRuntime {
  return {
    mode: 'tun',
    async prepare(spec: ConnectionSpec): Promise<PreparedConnection> {
      const perf = configService.getPerformanceSettings();
      const tunAutoRoute = resolveTunAutoRoute(process.platform, perf);

      // Always discover default route + server IPs on Windows. Domain endpoints
      // need host /32 routes pinned *before* Xray installs 0.0.0.0/0 via TUN.
      const needsHostPin = process.platform === 'win32';
      const routingPlan =
        needsHostPin || !tunAutoRoute
          ? await routeService.prepareRoutingPlan(spec.server, {
              awaitStableDefaultRoute: false,
            })
          : undefined;

      let server = spec.server;
      if (routingPlan?.proxyIps[0]) {
        if (needsHostPin) {
          await routeService.pinProxyHostRoutes(routingPlan);
        }
        server = bindProxyEndpointToIp(spec.server, routingPlan.proxyIps[0]);
      }

      return {
        spec,
        server,
        routingPlan,
        xrayOptions: {
          sendThrough: tunAutoRoute
            ? undefined
            : routingPlan?.defaultRoute.localAddress || undefined,
          tunAutoRoute,
        },
      };
    },
    async activate(prepared: PreparedConnection): Promise<void> {
      await routeService.enable(prepared.server, prepared.routingPlan);
    },
    async deactivate(): Promise<void> {
      await routeService.disable();
    },
  };
}
