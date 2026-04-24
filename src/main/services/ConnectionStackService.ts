import { ConnectionMode, VlessConfig } from '@/shared/types';
import { logger } from './LoggerService';
import { systemProxyService, SystemProxyService } from './SystemProxyService';
import { tunRouteService, TunRouteService } from './TunRouteService';
import { xrayService, XrayService } from './XrayService';

interface ProxyPorts {
  http: number;
  socks: number;
}

interface TransitionOptions {
  delayBeforeApplyMs?: number;
  stopXray?: boolean;
}

/**
 * Centralizes connect/disconnect stack orchestration for Proxy/TUN modes.
 * This keeps behavior consistent between manual connect and auto-switch flows.
 */
export class ConnectionStackService {
  private stackQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly proxyService: SystemProxyService = systemProxyService,
    private readonly routeService: TunRouteService = tunRouteService,
    private readonly coreService: XrayService = xrayService,
  ) {}

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.stackQueue.then(task, task);
    this.stackQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async resetNetworkingStackUnsafe(
    options: { stopXray?: boolean } = {},
  ): Promise<void> {
    const { stopXray = true } = options;
    await this.proxyService.disable();
    await this.routeService.disable();
    if (stopXray) {
      this.coreService.stop();
    }
  }

  private async applyConnectionModeUnsafe(
    server: VlessConfig,
    mode: ConnectionMode,
    ports: ProxyPorts,
  ): Promise<void> {
    if (mode === 'proxy') {
      await this.coreService.start(server, mode);
      await this.proxyService.enable(ports.http, ports.socks);
      return;
    }

    const routingPlan = await this.routeService.prepareRoutingPlan(server);
    await this.coreService.start(server, mode, {
      // Prevent outbound loop when TUN default route is enabled.
      sendThrough: routingPlan.defaultRoute.localAddress || undefined,
      tunAutoRoute: process.platform !== 'win32',
    });
    await this.routeService.enable(server, routingPlan);
  }

  private async transitionToUnsafe(
    server: VlessConfig,
    mode: ConnectionMode,
    ports: ProxyPorts,
    options: TransitionOptions = {},
  ): Promise<void> {
    const { delayBeforeApplyMs = 0, stopXray = true } = options;
    await this.resetNetworkingStackUnsafe({ stopXray });
    if (delayBeforeApplyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayBeforeApplyMs));
    }
    await this.applyConnectionModeUnsafe(server, mode, ports);
  }

  public async resetNetworkingStack(
    options: { stopXray?: boolean } = {},
  ): Promise<void> {
    return this.enqueue(() => this.resetNetworkingStackUnsafe(options));
  }

  public async applyConnectionMode(
    server: VlessConfig,
    mode: ConnectionMode,
    ports: ProxyPorts,
  ): Promise<void> {
    return this.enqueue(() =>
      this.applyConnectionModeUnsafe(server, mode, ports),
    );
  }

  public async transitionTo(
    server: VlessConfig,
    mode: ConnectionMode,
    ports: ProxyPorts,
    options: TransitionOptions = {},
  ): Promise<void> {
    return this.enqueue(() =>
      this.transitionToUnsafe(server, mode, ports, options),
    );
  }

  public async cleanupAfterFailure(): Promise<void> {
    return this.enqueue(async () => {
      try {
        await this.resetNetworkingStackUnsafe({ stopXray: true });
      } catch (error) {
        logger.error(
          'ConnectionStackService',
          'Failed to cleanup network stack',
          error,
        );
        throw error;
      }
    });
  }
}

export const connectionStackService = new ConnectionStackService();
