import type { ConnectionMode, VlessConfig } from '@/shared/types';
import type { ConfigService } from '@/main/services/ConfigService';
import type { SystemProxyService } from '@/main/services/SystemProxyService';
import type {
  TunRouteService,
  TunRoutingPlan,
} from '@/main/services/TunRouteService';
import type { XrayStartOptions } from '@/main/services/XrayService';
import { isLinuxIpv6Available } from '@/main/services/tunRoute/linuxIpv6';
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
      await proxyService.enable(
        prepared.spec.ports.http,
        prepared.spec.ports.socks,
      );
    },
    async deactivate(): Promise<void> {
      await proxyService.disable();
    },
  };
}

export function createTunNetworkRuntime(
  routeService: Pick<TunRouteService, 'prepareRoutingPlan'>,
  configService: Pick<ConfigService, 'getPerformanceSettings'>,
  platform: NodeJS.Platform = process.platform,
): NetworkModeRuntime {
  return {
    mode: 'tun',
    async prepare(spec: ConnectionSpec): Promise<PreparedConnection> {
      const perf = configService.getPerformanceSettings();
      const routingPlan =
        platform === 'win32'
          ? await routeService.prepareRoutingPlan(spec.server)
          : undefined;
      const server = routingPlan?.proxyIps[0]
        ? bindProxyEndpointToIp(spec.server, routingPlan.proxyIps[0])
        : spec.server;

      return {
        spec,
        server,
        routingPlan,
        xrayOptions: {
          outboundInterface: routingPlan?.outboundInterface || undefined,
          blockDnsLeaks: platform === 'win32' && perf.tunBlockDnsLeaks === true,
          tunIpv6: platform === 'linux' ? isLinuxIpv6Available() : undefined,
          tunSplitDefaultRoute: platform === 'linux',
        },
      };
    },
    // Xray adds the TUN routes when it starts and removes them when it exits.
    async activate(): Promise<void> {},
    async deactivate(): Promise<void> {},
  };
}
