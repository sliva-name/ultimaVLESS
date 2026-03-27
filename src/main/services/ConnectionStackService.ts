import { ConnectionMode, VlessConfig } from '../../shared/types';
import { logger } from './LoggerService';
import { systemProxyService, SystemProxyService } from './SystemProxyService';
import { tunRouteService, TunRouteService } from './TunRouteService';
import { xrayService, XrayService } from './XrayService';

interface ProxyPorts {
  http: number;
  socks: number;
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
    private readonly coreService: XrayService = xrayService
  ) {}

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.stackQueue.then(task, task);
    this.stackQueue = run.then(() => undefined, () => undefined);
    return run;
  }

  private async resetNetworkingStackUnsafe(options: { stopXray?: boolean } = {}): Promise<void> {
    const { stopXray = true } = options;
    await this.proxyService.disable();
    await this.routeService.disable();
    if (stopXray) {
      this.coreService.stop();
    }
  }

  private async applyConnectionModeUnsafe(server: VlessConfig, mode: ConnectionMode, ports: ProxyPorts): Promise<void> {
    if (mode === 'proxy') {
      // Ensure TUN leftovers from previous sessions are removed before proxy mode starts.
      await this.routeService.disable();
      await this.proxyService.disable();
      await this.coreService.start(server, mode);
      await this.proxyService.enable(ports.http, ports.socks);
      return;
    }

    // Ensure clean state before TUN setup to avoid route/proxy races.
    await this.routeService.disable();
    await this.proxyService.disable();
    await this.coreService.start(server, mode);
    // Defensive disable once more in case system proxy was externally re-enabled.
    await this.proxyService.disable();
    await this.routeService.enable(server);
  }

  public async resetNetworkingStack(options: { stopXray?: boolean } = {}): Promise<void> {
    return this.enqueue(() => this.resetNetworkingStackUnsafe(options));
  }

  public async applyConnectionMode(server: VlessConfig, mode: ConnectionMode, ports: ProxyPorts): Promise<void> {
    return this.enqueue(() => this.applyConnectionModeUnsafe(server, mode, ports));
  }

  public async cleanupAfterFailure(): Promise<void> {
    return this.enqueue(async () => {
      try {
        await this.resetNetworkingStackUnsafe({ stopXray: true });
      } catch (error) {
        logger.error('ConnectionStackService', 'Failed to cleanup network stack', error);
        throw error;
      }
    });
  }
}

export const connectionStackService = new ConnectionStackService();
