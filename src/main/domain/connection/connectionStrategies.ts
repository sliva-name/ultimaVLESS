import type { ConnectionMode, VlessConfig } from '@/shared/types';
import { resolveTunAutoRoute } from '@/shared/tunRouting';
import type { ConfigService } from '@/main/services/ConfigService';
import type { SystemProxyService } from '@/main/services/SystemProxyService';
import type { TunRouteService } from '@/main/services/TunRouteService';
import type { XrayService } from '@/main/services/XrayService';
import { bindProxyEndpointToIp } from './bindProxyEndpoint';

export interface ProxyPorts {
  http: number;
  socks: number;
}

export interface NetworkTeardown {
  reset: (options?: {
    stopXray?: boolean;
    /** Keep WinINET/gsettings proxy pointing at loopback during a switch. */
    keepSystemProxy?: boolean;
  }) => Promise<void>;
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
    async reset(
      options: { stopXray?: boolean; keepSystemProxy?: boolean } = {},
    ): Promise<void> {
      const { stopXray = true, keepSystemProxy = false } = options;
      // When switching servers, leave the system proxy aimed at 127.0.0.1 so
      // proxy-aware apps fail closed (connection refused) instead of going
      // clearnet while the new Xray instance is coming up. Full disconnects
      // still restore the user's original proxy settings.
      const teardownTasks: Array<Promise<void>> = [
        deps.routeService.disable(),
      ];
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
      const tunAutoRoute = resolveTunAutoRoute(process.platform, perf);

      // Always discover default route + server IPs on Windows. Domain endpoints
      // (e.g. *.figmafound.org) need host /32 routes pinned *before* Xray
      // installs 0.0.0.0/0 via TUN, otherwise REALITY dials loop for ~12s.
      // Skip the stable-route double-sample here — one probe is enough for pin.
      const needsHostPin = process.platform === 'win32';
      const routingPlan = needsHostPin || !tunAutoRoute
        ? await deps.routeService.prepareRoutingPlan(server, {
            awaitStableDefaultRoute: false,
          })
        : undefined;

      let serverToStart = server;
      if (routingPlan?.proxyIps[0]) {
        if (needsHostPin) {
          await deps.routeService.pinProxyHostRoutes(routingPlan);
        }
        serverToStart = bindProxyEndpointToIp(server, routingPlan.proxyIps[0]);
      }

      await deps.coreService.start(serverToStart, 'tun', {
        // When Xray owns routes via autoOutboundsInterface, skip sendThrough
        // (docs prefer interface binding; sendThrough is IPv4/IPv6 single-stack).
        sendThrough: tunAutoRoute
          ? undefined
          : routingPlan?.defaultRoute.localAddress || undefined,
        tunAutoRoute,
      });
      await deps.routeService.enable(serverToStart, routingPlan);
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
