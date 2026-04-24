import dns from 'dns';
import net from 'net';
import { VlessConfig } from '@/shared/types';
import { logger } from './LoggerService';
import { configService } from './ConfigService';
import {
  DefaultRouteInfo,
  DEFAULT_ROUTE_ADD_RETRIES,
  DEFAULT_ROUTE_ADD_RETRY_DELAY_MS,
  DEFAULT_ROUTE_STABLE_HITS,
  DEFAULT_ROUTE_WAIT_INTERVAL,
  DEFAULT_ROUTE_WAIT_TIMEOUT,
  DNS_TIMEOUT,
  ENABLE_TIMEOUT,
  TUN_NEXTHOP,
  TUN_ROUTE_METRIC,
  TUN_WAIT_TIMEOUT,
} from './tunRoute/constants';
import {
  addDefaultRouteViaTunScript,
  addRouteScript,
  deleteHostRoutesByPrefixesAndMetricScript,
  deleteRouteByPrefixAndMetricScript,
  deleteRouteScript,
  deleteTunDefaultRoutesByNextHopScript,
  ensureTunAddressScript,
  getDefaultRouteScript,
  getTunInterfaceIndexScript,
  waitForTunInterfaceScript,
} from './tunRoute/windowsScripts';
import {
  getLinuxDefaultRouteInfo,
  getMacosDefaultRouteInfo,
} from './tunRoute/unixRouting';
import {
  runPowerShell as runPowerShellScript,
  RunPowerShellOptions,
} from './tunRoute/powerShellRunner';

export interface TunRoutingPlan {
  defaultRoute: DefaultRouteInfo;
  proxyIps: string[];
}

interface AddedRoute {
  destination: string;
  mask: string;
  interfaceIndex?: number;
}

/**
 * Coordinates TUN-mode routing. Windows performs explicit OS-level route
 * manipulation through PowerShell; Linux/macOS defer to Xray's auto-route
 * behaviour and only probe the current default route for diagnostics.
 */
export class TunRouteService {
  private addedRoutes: AddedRoute[] = [];
  constructor(private readonly platform: NodeJS.Platform = process.platform) {}

  public isSupported(): boolean {
    return this.platform === 'win32' || this.platform === 'linux';
  }

  public getUnsupportedReason(): string | null {
    if (this.isSupported()) return null;
    if (this.platform === 'darwin') {
      return 'TUN mode is currently supported only on Windows and Linux by the bundled Xray core.';
    }
    return 'TUN mode is not supported on this operating system.';
  }

  public getRouteMode(): string | null {
    if (this.platform === 'win32') return 'windows-static-routes';
    if (this.platform === 'linux') return 'linux-xray-auto-route';
    return null;
  }

  public getDegradedReason(): string | null {
    if (this.platform === 'linux') {
      return 'Linux TUN routing currently relies on Xray auto-route behavior rather than explicit OS-level route teardown.';
    }
    return null;
  }

  public async prepareRoutingPlan(
    config: VlessConfig,
  ): Promise<TunRoutingPlan> {
    const unsupportedReason = this.getUnsupportedReason();
    if (unsupportedReason) {
      throw new Error(unsupportedReason);
    }
    if (this.platform !== 'win32') {
      return this.prepareUnixRoutingPlan(config);
    }
    const [defaultRoute, proxyIps] = await Promise.all([
      this.waitForDefaultRoute(),
      this.resolveProxyAddresses(config.address),
    ]);

    if (!defaultRoute) {
      throw new Error('Could not get default route. Check network connection.');
    }
    if (proxyIps.length === 0) {
      throw new Error(
        `Could not resolve proxy server address: ${config.address}`,
      );
    }

    return { defaultRoute, proxyIps };
  }

  public async enable(
    config: VlessConfig,
    plan?: TunRoutingPlan,
  ): Promise<void> {
    if (this.platform !== 'win32') {
      const routingPlan = plan ?? (await this.prepareRoutingPlan(config));
      logger.info(
        'TunRouteService',
        'Using Xray auto-route for TUN mode on Unix platform',
        {
          platform: this.platform,
          proxyIpCount: routingPlan.proxyIps.length,
          defaultInterface: routingPlan.defaultRoute.interfaceName,
        },
      );
      return;
    }

    const startedAt = Date.now();
    const deadline = startedAt + ENABLE_TIMEOUT;
    try {
      const [routingPlan, tunInterfaceIndex] = await Promise.all([
        plan ? Promise.resolve(plan) : this.prepareRoutingPlan(config),
        this.waitForTunInterface(),
      ]);
      const { defaultRoute, proxyIps } = routingPlan;
      this.ensureWithinDeadline(deadline, 'initial discovery');
      logger.info('TunRouteService', 'Discovery completed', {
        hasDefaultRoute: true,
        proxyIpCount: proxyIps.length,
        tunInterfaceIndex,
      });
      logger.info('TunRouteService', 'Using default route candidate', {
        interfaceIndex: defaultRoute.interfaceIndex,
        interfaceName: defaultRoute.interfaceName,
        gateway: defaultRoute.gateway,
        localAddress: defaultRoute.localAddress,
      });

      await this.ensureTunAddress(tunInterfaceIndex);
      this.ensureWithinDeadline(deadline, 'set TUN interface address');

      for (const proxyIp of proxyIps) {
        this.ensureWithinDeadline(deadline, `add host route for ${proxyIp}`);
        await this.addRoute(
          proxyIp,
          '255.255.255.255',
          defaultRoute.gateway,
          1,
          defaultRoute.interfaceIndex,
        );
      }
      this.ensureWithinDeadline(deadline, 'add default route via TUN');
      await this.addDefaultRouteViaTun(tunInterfaceIndex);

      logger.info('TunRouteService', 'TUN routing enabled', {
        proxyIps,
        defaultGateway: defaultRoute.gateway,
        setupDurationMs: Date.now() - startedAt,
      });
    } catch (error) {
      await this.disable();
      throw error;
    }
  }

  public async disable(): Promise<void> {
    if (this.platform !== 'win32') {
      logger.info(
        'TunRouteService',
        'Unix TUN cleanup delegated to Xray process lifecycle',
        {
          platform: this.platform,
          routeMode: this.getRouteMode(),
        },
      );
      return;
    }

    for (const route of [...this.addedRoutes].reverse()) {
      try {
        await this.deleteRoute(route);
      } catch (error) {
        logger.warn('TunRouteService', 'Failed to remove route', {
          destination: route.destination,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    this.addedRoutes = [];
    try {
      await this.cleanupStaleTunRoutes();
    } catch (error) {
      logger.warn('TunRouteService', 'Stale route cleanup failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    logger.info('TunRouteService', 'TUN routing disabled');
  }

  // ---- Unix helpers ---------------------------------------------------------

  private async prepareUnixRoutingPlan(
    config: VlessConfig,
  ): Promise<TunRoutingPlan> {
    const [defaultRoute, proxyIps] = await Promise.all([
      this.getUnixDefaultRouteInfo(),
      this.resolveProxyAddresses(config.address),
    ]);
    if (!defaultRoute) {
      throw new Error('Could not get default route. Check network connection.');
    }
    if (proxyIps.length === 0) {
      throw new Error(
        `Could not resolve proxy server address: ${config.address}`,
      );
    }
    return { defaultRoute, proxyIps };
  }

  private async getUnixDefaultRouteInfo(): Promise<DefaultRouteInfo | null> {
    if (this.platform === 'linux') return getLinuxDefaultRouteInfo();
    if (this.platform === 'darwin') return getMacosDefaultRouteInfo();
    return null;
  }

  // ---- Windows route discovery ---------------------------------------------

  private async getDefaultRoute(): Promise<DefaultRouteInfo | null> {
    const out = await this.runPowerShell(getDefaultRouteScript(), {
      allowNonZeroExit: true,
    });
    const match = out.trim().match(/^(\d+)\|([^\s|]+)\|([^|]+)(?:\|(.*))?$/);
    if (!match) return null;
    const localAddress = match[4]?.trim() || '';
    return {
      interfaceIndex: parseInt(match[1], 10),
      gateway: match[2].trim(),
      interfaceName: match[3].trim(),
      localAddress: localAddress.length > 0 ? localAddress : null,
    };
  }

  private async waitForDefaultRoute(): Promise<DefaultRouteInfo | null> {
    const startedAt = Date.now();
    let previousRouteKey: string | null = null;
    let stableHits = 0;
    let lastObservedRoute: DefaultRouteInfo | null = null;

    while (Date.now() - startedAt <= DEFAULT_ROUTE_WAIT_TIMEOUT) {
      const route = await this.getDefaultRoute();
      if (route) {
        lastObservedRoute = route;
        const routeKey = `${route.interfaceIndex}|${route.gateway}`;
        if (routeKey === previousRouteKey) {
          stableHits += 1;
        } else {
          previousRouteKey = routeKey;
          stableHits = 1;
        }
        if (stableHits >= DEFAULT_ROUTE_STABLE_HITS) {
          return route;
        }
      } else {
        previousRouteKey = null;
        stableHits = 0;
      }
      await this.sleep(DEFAULT_ROUTE_WAIT_INTERVAL);
    }
    return lastObservedRoute;
  }

  private async waitForTunInterface(): Promise<number> {
    const out = await this.runPowerShell(waitForTunInterfaceScript()).catch(
      (error) => {
        const details = error instanceof Error ? error.message : String(error);
        throw new Error(
          `TUN interface did not appear within ${TUN_WAIT_TIMEOUT / 1000}s. ` +
            `Make sure app runs as Administrator and Xray has TUN support. Details: ${details}`,
        );
      },
    );
    const idx = parseInt(out.trim(), 10);
    if (Number.isNaN(idx)) {
      throw new Error(
        `TUN interface did not appear within ${TUN_WAIT_TIMEOUT / 1000}s. ` +
          `Make sure app runs as Administrator and Xray has TUN support.`,
      );
    }
    logger.info('TunRouteService', 'TUN interface found', { index: idx });
    return idx;
  }

  private async getTunInterfaceIndex(): Promise<number | null> {
    const out = await this.runPowerShell(getTunInterfaceIndexScript(), {
      allowNonZeroExit: true,
    });
    const n = parseInt(out.trim(), 10);
    return Number.isNaN(n) ? null : n;
  }

  private async ensureTunAddress(tunInterfaceIndex: number): Promise<void> {
    try {
      await this.runPowerShell(ensureTunAddressScript(tunInterfaceIndex));
    } catch (e) {
      logger.warn(
        'TunRouteService',
        'Could not set TUN address (Xray may have set it)',
        {
          error: e instanceof Error ? e.message : String(e),
        },
      );
    }
  }

  // ---- DNS / route arithmetic ----------------------------------------------

  private async resolveProxyAddresses(address: string): Promise<string[]> {
    if (this.isIp(address)) return [address];
    let timeoutHandle: NodeJS.Timeout | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(
        () => reject(new Error('DNS lookup timeout')),
        DNS_TIMEOUT,
      );
    });
    try {
      const resolver = new dns.promises.Resolver();
      resolver.setServers(['8.8.8.8', '1.1.1.1']);
      const result = await Promise.race<string[]>([
        resolver.resolve4(address),
        timeoutPromise,
      ]);
      return [...new Set(result)];
    } catch {
      return [];
    } finally {
      if (timeoutHandle !== null) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  /** Accepts both IPv4 and IPv6 literals. Used to skip DNS lookups. */
  private isIp(str: string): boolean {
    return net.isIP(str) !== 0;
  }

  private maskToPrefix(mask: string): number {
    const parts = mask.split('.').map(Number);
    let n = 0;
    for (const p of parts) n = (n << 8) | p;
    let bits = 0;
    while (n) {
      bits += n & 1;
      n >>>= 1;
    }
    return bits;
  }

  // ---- Windows route mutation ----------------------------------------------

  private async addRoute(
    destination: string,
    mask: string,
    gateway: string,
    metric: number,
    interfaceIndex?: number,
  ): Promise<boolean> {
    if (net.isIP(destination) === 0) {
      throw new Error(
        `Refusing to add route for non-IP destination: ${destination}`,
      );
    }
    if (net.isIP(gateway) === 0) {
      throw new Error(`Refusing to add route with non-IP gateway: ${gateway}`);
    }
    if (!Number.isInteger(metric) || metric < 0 || metric > 65535) {
      throw new Error(`Invalid route metric: ${metric}`);
    }
    if (interfaceIndex != null && !Number.isInteger(interfaceIndex)) {
      throw new Error(`Invalid interface index: ${interfaceIndex}`);
    }
    const prefixLen = this.maskToPrefix(mask);
    const destPrefix = `${destination}/${prefixLen}`;
    const out = await this.runPowerShell(
      addRouteScript(destPrefix, gateway, metric, interfaceIndex),
    );
    const created = out.includes('CREATED');
    if (created) {
      this.addedRoutes.push({ destination, mask, interfaceIndex });
    }
    return created;
  }

  private async addDefaultRouteViaTun(tunIdx: number): Promise<void> {
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= DEFAULT_ROUTE_ADD_RETRIES; attempt += 1) {
      try {
        const out = await this.runPowerShell(
          addDefaultRouteViaTunScript(tunIdx),
        );
        if (out.includes('CREATED')) {
          this.addedRoutes.push({
            destination: '0.0.0.0',
            mask: '0.0.0.0',
            interfaceIndex: tunIdx,
          });
        }
        return;
      } catch (error) {
        lastError = error;
        if (attempt < DEFAULT_ROUTE_ADD_RETRIES) {
          logger.warn('TunRouteService', 'Retrying add default route via TUN', {
            interfaceIndex: tunIdx,
            attempt,
            maxAttempts: DEFAULT_ROUTE_ADD_RETRIES,
            error: error instanceof Error ? error.message : String(error),
          });
          await this.sleep(DEFAULT_ROUTE_ADD_RETRY_DELAY_MS);
        }
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error('Failed to add default route via TUN');
  }

  private async deleteRoute(route: AddedRoute): Promise<void> {
    const prefix =
      route.destination === '0.0.0.0' ? '0.0.0.0/0' : `${route.destination}/32`;
    await this.runPowerShell(deleteRouteScript(prefix, route.interfaceIndex), {
      allowNonZeroExit: true,
    });
  }

  private async cleanupStaleTunRoutes(): Promise<void> {
    const knownServerIps = await this.getKnownServerIps();
    const tunIndex = await this.getTunInterfaceIndex();
    if (tunIndex != null) {
      await this.deleteRouteByPrefixAndMetric(
        '0.0.0.0/0',
        TUN_ROUTE_METRIC,
        tunIndex,
      ).catch((error) => {
        logger.warn(
          'TunRouteService',
          'Failed to cleanup stale TUN default route',
          {
            interfaceIndex: tunIndex,
            error: error instanceof Error ? error.message : String(error),
          },
        );
      });
    } else {
      // Fallback: remove stale default route candidates by next hop/metric even if
      // interface alias changed (e.g. "ultima0 #2") and exact index is unknown.
      await this.deleteTunDefaultRoutesByNextHop(
        TUN_NEXTHOP,
        TUN_ROUTE_METRIC,
      ).catch((error) => {
        logger.warn(
          'TunRouteService',
          'Failed to cleanup stale TUN default routes by next hop',
          {
            nextHop: TUN_NEXTHOP,
            error: error instanceof Error ? error.message : String(error),
          },
        );
      });
    }

    let removedHostRoutes = 0;
    try {
      removedHostRoutes = await this.deleteHostRoutesByPrefixesAndMetric(
        knownServerIps.map((ip) => `${ip}/32`),
        1,
      );
    } catch (error) {
      logger.warn('TunRouteService', 'Failed to cleanup stale host routes', {
        count: knownServerIps.length,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    logger.info('TunRouteService', 'Stale route cleanup finished', {
      removedHostRouteCandidates: knownServerIps.length,
      removedHostRoutes,
      checkedTunDefaultRoute: tunIndex != null,
    });
  }

  private async getKnownServerIps(): Promise<string[]> {
    const servers = configService.getServers();
    const resolved = await Promise.all(
      servers.map((server) => this.resolveProxyAddresses(server.address)),
    );
    return [...new Set(resolved.flat())];
  }

  private async deleteRouteByPrefixAndMetric(
    destinationPrefix: string,
    metric: number,
    interfaceIndex?: number,
  ): Promise<void> {
    await this.runPowerShell(
      deleteRouteByPrefixAndMetricScript(
        destinationPrefix,
        metric,
        interfaceIndex,
      ),
      { allowNonZeroExit: true },
    );
  }

  private async deleteTunDefaultRoutesByNextHop(
    nextHop: string,
    metric: number,
  ): Promise<void> {
    await this.runPowerShell(
      deleteTunDefaultRoutesByNextHopScript(nextHop, metric),
      { allowNonZeroExit: true },
    );
  }

  private async deleteHostRoutesByPrefixesAndMetric(
    destinationPrefixes: string[],
    metric: number,
  ): Promise<number> {
    if (destinationPrefixes.length === 0) return 0;
    const out = await this.runPowerShell(
      deleteHostRoutesByPrefixesAndMetricScript(destinationPrefixes, metric),
      { allowNonZeroExit: true },
    );
    const parsed = parseInt(out.trim(), 10);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  // ---- PowerShell runner ---------------------------------------------------
  // Kept as an instance method so tests can spy on it via `service as any`.

  private runPowerShell(
    script: string,
    options: RunPowerShellOptions = {},
  ): Promise<string> {
    return runPowerShellScript(script, options);
  }

  // ---- Misc utilities ------------------------------------------------------

  private ensureWithinDeadline(deadline: number, stage: string): void {
    if (Date.now() <= deadline) return;
    throw new Error(
      `TUN setup timed out after ${ENABLE_TIMEOUT / 1000}s while running: ${stage}. ` +
        'Xray may not support TUN on this system.',
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const tunRouteService = new TunRouteService();
