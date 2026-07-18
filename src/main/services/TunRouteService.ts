import dns from 'dns';
import net from 'net';
import { VlessConfig } from '@/shared/types';
import {
  getWindowsTunRouteModeLabel,
  resolveWindowsTunRouting,
  usesWindowsPowerShellTunRouting,
} from '@/shared/tunRouting';
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
  SYSTEM_DNS_TIMEOUT,
  STALE_ROUTE_CLEANUP_TIMEOUT,
  TUN_IPV6_NEXTHOP,
  TUN_NEXTHOP,
  TUN_ROUTE_METRIC,
  TUN_WAIT_TIMEOUT,
} from './tunRoute/constants';
import {
  deleteHostRoutesByPrefixesAndMetricScript,
  deleteRouteByPrefixAndMetricScript,
  deleteRouteScript,
  deleteTunDefaultRoutesByNextHopScript,
  enableTunRoutingScript,
  getDefaultRouteScript,
  getTunInterfaceIndexScript,
  reapplyHostRoutesScript,
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
import {
  createPlatformTunAdapter,
  PlatformTunAdapter,
} from './tunRoute/platformAdapter';

export interface TunRoutingPlan {
  defaultRoute: DefaultRouteInfo;
  proxyIps: string[];
}

export interface PrepareRoutingPlanOptions {
  /**
   * When true (default), wait for a stable default route (needed when applying
   * full PowerShell TUN tables). Host-pin before Xray start only needs one
   * observation — skipping the second sample saves ~0.5–2s per connect.
   */
  awaitStableDefaultRoute?: boolean;
}

interface AddedRoute {
  destination: string;
  mask: string;
  interfaceIndex?: number;
  prefix?: string;
}

interface StaleRouteCleanupOptions {
  includeKnownServerHostRoutes?: boolean;
}

/**
 * Coordinates TUN-mode routing. Windows performs explicit OS-level route
 * manipulation through PowerShell; Linux/macOS defer to Xray's auto-route
 * behaviour and only probe the current default route for diagnostics.
 */
export class TunRouteService {
  private addedRoutes: AddedRoute[] = [];
  /** Default route used by the last successful enable; lets resume recovery detect gateway changes. */
  private lastDefaultRoute: DefaultRouteInfo | null = null;
  private readonly platformAdapter: PlatformTunAdapter;

  constructor(private readonly platform: NodeJS.Platform = process.platform) {
    this.platformAdapter = createPlatformTunAdapter(platform);
  }

  public isSupported(): boolean {
    return this.platformAdapter.isSupported();
  }

  public getUnsupportedReason(): string | null {
    return this.platformAdapter.getUnsupportedReason();
  }

  public getRouteMode(): string | null {
    if (this.platform === 'win32') {
      return getWindowsTunRouteModeLabel(
        resolveWindowsTunRouting(configService.getPerformanceSettings()),
      );
    }
    return this.platformAdapter.getRouteMode();
  }

  private usesWindowsPowerShellRouting(): boolean {
    return usesWindowsPowerShellTunRouting(
      this.platform,
      configService.getPerformanceSettings(),
    );
  }

  public getDegradedReason(): string | null {
    return this.platformAdapter.getDegradedReason();
  }

  public async prepareRoutingPlan(
    config: VlessConfig,
    options: PrepareRoutingPlanOptions = {},
  ): Promise<TunRoutingPlan> {
    const unsupportedReason = this.getUnsupportedReason();
    if (unsupportedReason) {
      throw new Error(unsupportedReason);
    }
    if (this.platform !== 'win32') {
      return this.prepareUnixRoutingPlan(config);
    }
    const awaitStable = options.awaitStableDefaultRoute !== false;
    const [defaultRoute, proxyIps] = await Promise.all([
      awaitStable ? this.waitForDefaultRoute() : this.getDefaultRouteQuick(),
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

  /**
   * Pin /32 (/128) routes for the VPN server via the physical gateway so
   * REALITY dials are not swallowed by TUN's 0.0.0.0/0 (classic ~12s stall
   * for domain endpoints). Safe to call before Xray starts.
   */
  public async pinProxyHostRoutes(plan: TunRoutingPlan): Promise<void> {
    if (this.platform !== 'win32') return;
    const { defaultRoute, proxyIps } = plan;
    if (proxyIps.length === 0) {
      throw new Error('No proxy server IPs to pin for TUN host routes');
    }
    const prefixes = proxyIps.map((ip) => this.hostPrefixForIp(ip));
    const output = await this.runPowerShell(
      reapplyHostRoutesScript({
        defaultRouteInterfaceIndex: defaultRoute.interfaceIndex,
        gateway: defaultRoute.gateway,
        proxyHostPrefixes: prefixes,
        hostRouteMetric: 1,
      }),
    );
    const hostFailures: string[] = [];
    for (const line of output.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed.startsWith('HOST_CREATED|')) {
        const prefix = trimmed.slice('HOST_CREATED|'.length);
        this.addedRoutes.push({
          destination: prefix,
          mask: '',
          prefix,
          interfaceIndex: defaultRoute.interfaceIndex,
        });
      } else if (trimmed.startsWith('HOST_FAIL|')) {
        hostFailures.push(trimmed.slice('HOST_FAIL|'.length));
      }
    }
    this.lastDefaultRoute = defaultRoute;
    if (hostFailures.length > 0) {
      throw new Error(
        `Failed to pin proxy host route(s) to the physical gateway: ${hostFailures.join('; ')}`,
      );
    }
    logger.info('TunRouteService', 'Pinned proxy host routes for TUN', {
      gateway: defaultRoute.gateway,
      interfaceIndex: defaultRoute.interfaceIndex,
      prefixes,
    });
  }

  public async enable(
    config: VlessConfig,
    plan?: TunRoutingPlan,
  ): Promise<void> {
    if (this.platform !== 'win32' || !this.usesWindowsPowerShellRouting()) {
      logger.info('TunRouteService', 'Using Xray auto-route for TUN mode', {
        platform: this.platform,
        routeMode: this.getRouteMode(),
        proxyIpCount: plan?.proxyIps.length ?? null,
        defaultInterface: plan?.defaultRoute.interfaceName ?? null,
        serverAddress: config.address,
      });
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

      this.ensureWithinDeadline(deadline, 'apply TUN routing');
      // All Windows route mutations (stale cleanup, TUN address/DNS, proxy host
      // routes, and the TUN default route) run in a single PowerShell process
      // to avoid paying the per-spawn startup cost for each step.
      await this.applyWindowsTunRouting(defaultRoute, proxyIps, tunInterfaceIndex);

      logger.info('TunRouteService', 'TUN routing enabled', {
        proxyIps,
        defaultGateway: defaultRoute.gateway,
        tunInterfaceIndex,
        setupDurationMs: Date.now() - startedAt,
      });
    } catch (error) {
      // Full rollback: the enable script may have created host routes before
      // failing (DEFAULT_FAIL / HOST_FAIL exits without bookkeeping), so the
      // cleanup must also sweep known-server /32 host routes.
      await this.disable({ includeKnownServerHostRoutes: true });
      throw error;
    }
  }

  public async disable(
    cleanupOptions: StaleRouteCleanupOptions = {},
  ): Promise<void> {
    if (this.platform !== 'win32') {
      logger.info(
        'TunRouteService',
        'TUN cleanup delegated to Xray process lifecycle',
        {
          platform: this.platform,
          routeMode: this.getRouteMode(),
        },
      );
      return;
    }

    // Host routes are pinned for both PowerShell and Xray auto-route modes.
    // Prefer one PowerShell batch over N sequential deletes.
    const hostPrefixes = this.addedRoutes
      .map((route) => route.prefix)
      .filter((prefix): prefix is string => Boolean(prefix));
    if (hostPrefixes.length > 0) {
      try {
        await this.deleteHostRoutesByPrefixesAndMetric(hostPrefixes, 1);
      } catch (error) {
        logger.warn('TunRouteService', 'Batch host-route removal failed', {
          error: error instanceof Error ? error.message : String(error),
        });
        for (const route of [...this.addedRoutes].reverse()) {
          try {
            await this.deleteRoute(route);
          } catch (deleteError) {
            logger.warn('TunRouteService', 'Failed to remove route', {
              destination: route.destination,
              error:
                deleteError instanceof Error
                  ? deleteError.message
                  : String(deleteError),
            });
          }
        }
      }
    } else {
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
    }
    this.addedRoutes = [];
    this.lastDefaultRoute = null;

    if (!this.usesWindowsPowerShellRouting()) {
      // Tracked host routes already removed above. Skip the full stale sweep —
      // it costs another PowerShell process and is not needed for a clean
      // disconnect (next connect re-pins the same /32s if anything lingered).
      logger.info('TunRouteService', 'TUN host routes cleared (Xray auto-route)');
      return;
    }

    try {
      await this.cleanupStaleTunRoutes(cleanupOptions);
    } catch (error) {
      logger.warn('TunRouteService', 'Stale route cleanup failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    logger.info('TunRouteService', 'TUN routing disabled');
  }

  /**
   * Removes orphaned TUN default/host routes left behind by a previous
   * crashed or hard-killed session. Intended to be called once at app
   * startup; safe no-op on platforms without PowerShell TUN routing.
   */
  public async recoverOrphanedRoutes(): Promise<void> {
    if (this.platform !== 'win32' || !this.usesWindowsPowerShellRouting()) {
      return;
    }
    try {
      await this.cleanupStaleTunRoutes({ includeKnownServerHostRoutes: true });
    } catch (error) {
      logger.warn('TunRouteService', 'Orphaned route recovery failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Re-pins proxy host routes to the current default gateway after a system
   * resume, when the gateway may have changed while TUN stayed active.
   * No-op when TUN routing is inactive or the gateway is unchanged.
   */
  public async reapplyRoutesAfterResume(): Promise<void> {
    if (this.platform !== 'win32' || !this.usesWindowsPowerShellRouting()) {
      return;
    }
    const hostRoutes = this.addedRoutes.filter(
      (route) => route.prefix != null && route.prefix !== '::/0',
    );
    if (hostRoutes.length === 0) return;
    try {
      const currentRoute = await this.waitForDefaultRoute();
      if (!currentRoute) {
        logger.warn(
          'TunRouteService',
          'No default route found after resume; keeping existing host routes',
        );
        return;
      }
      const previous = this.lastDefaultRoute;
      if (
        previous &&
        previous.gateway === currentRoute.gateway &&
        previous.interfaceIndex === currentRoute.interfaceIndex
      ) {
        return;
      }
      const prefixes = hostRoutes.map((route) => route.prefix as string);
      const output = await this.runPowerShell(
        reapplyHostRoutesScript({
          defaultRouteInterfaceIndex: currentRoute.interfaceIndex,
          gateway: currentRoute.gateway,
          proxyHostPrefixes: prefixes,
          hostRouteMetric: 1,
        }),
      );
      for (const line of output.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed.startsWith('HOST_FAIL|')) {
          logger.warn(
            'TunRouteService',
            'Failed to re-pin proxy host route after resume',
            { detail: trimmed.slice('HOST_FAIL|'.length) },
          );
        }
      }
      for (const route of hostRoutes) {
        route.interfaceIndex = currentRoute.interfaceIndex;
      }
      this.lastDefaultRoute = currentRoute;
      logger.info('TunRouteService', 'Re-pinned host routes after resume', {
        gateway: currentRoute.gateway,
        interfaceIndex: currentRoute.interfaceIndex,
        prefixes,
      });
    } catch (error) {
      logger.warn('TunRouteService', 'Route reapply after resume failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
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

  /** One PowerShell probe (+ one quick retry) for the host-pin connect path. */
  private async getDefaultRouteQuick(): Promise<DefaultRouteInfo | null> {
    const first = await this.getDefaultRoute();
    if (first) return first;
    await this.sleep(150);
    return this.getDefaultRoute();
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

  private async getTunInterfaceIndex(
    options: RunPowerShellOptions = {},
  ): Promise<number | null> {
    const out = await this.runPowerShell(getTunInterfaceIndexScript(), {
      allowNonZeroExit: true,
      ...options,
    });
    const n = parseInt(out.trim(), 10);
    return Number.isNaN(n) ? null : n;
  }

  // ---- DNS / route arithmetic ----------------------------------------------

  private async resolveProxyAddresses(address: string): Promise<string[]> {
    if (this.isIp(address)) return [address];

    // Prefer OS resolver (local cache / ISP DNS) — usually much faster than
    // forcing a cold query to 8.8.8.8 from a fresh Resolver instance.
    try {
      const system = await this.withTimeout(
        dns.promises.lookup(address, { all: true }),
        SYSTEM_DNS_TIMEOUT,
      );
      const systemIps = [
        ...new Set(system.map((entry) => entry.address).filter(Boolean)),
      ];
      if (systemIps.length > 0) {
        return systemIps;
      }
    } catch {
      // Fall through to public resolvers.
    }

    let timeoutHandle: NodeJS.Timeout | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(
        () => reject(new Error('DNS lookup timeout')),
        DNS_TIMEOUT,
      );
    });
    try {
      const resolver = new dns.promises.Resolver();
      resolver.setServers(['1.1.1.1', '8.8.8.8']);
      const ipv4 = await Promise.race<string[]>([
        resolver.resolve4(address).catch(() => []),
        timeoutPromise,
      ]);
      if (ipv4.length > 0) {
        return [...new Set(ipv4)];
      }
      // IPv6-only hosts have no A records; fall back to AAAA.
      const ipv6 = await Promise.race<string[]>([
        resolver.resolve6(address).catch(() => []),
        timeoutPromise,
      ]);
      return [...new Set(ipv6)];
    } catch {
      return [];
    } finally {
      if (timeoutHandle !== null) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
  ): Promise<T> {
    let timeoutHandle: NodeJS.Timeout | null = null;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timeoutHandle = setTimeout(
            () => reject(new Error('operation timeout')),
            timeoutMs,
          );
        }),
      ]);
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

  private hostPrefixForIp(ip: string): string {
    return `${ip}/${net.isIP(ip) === 6 ? 128 : 32}`;
  }

  // ---- Windows route mutation ----------------------------------------------

  /**
   * Runs the complete Windows TUN routing setup in a single PowerShell process
   * and records the routes it created so {@link disable} can remove them later.
   */
  private async applyWindowsTunRouting(
    defaultRoute: DefaultRouteInfo,
    proxyIps: string[],
    tunInterfaceIndex: number,
  ): Promise<void> {
    const proxyHostPrefixes = proxyIps.map((ip) => this.hostPrefixForIp(ip));
    const output = await this.runPowerShell(
      enableTunRoutingScript({
        tunInterfaceIndex,
        defaultRouteInterfaceIndex: defaultRoute.interfaceIndex,
        gateway: defaultRoute.gateway,
        proxyHostPrefixes,
        // Proxy host routes keep the original metric 1 so they outrank the TUN
        // default route and let tunnel traffic reach the server via the gateway.
        hostRouteMetric: 1,
        defaultRouteRetries: DEFAULT_ROUTE_ADD_RETRIES,
        defaultRouteRetryDelayMs: DEFAULT_ROUTE_ADD_RETRY_DELAY_MS,
      }),
    );
    this.recordEnabledRoutes(output, defaultRoute.interfaceIndex, tunInterfaceIndex);
    this.lastDefaultRoute = defaultRoute;
    // A missing host route means traffic to the VPN server itself would be
    // swallowed by the TUN default route — the tunnel can never connect, so
    // treat HOST_FAIL as fatal (the caller rolls back everything we created).
    const hostFailures = output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith('HOST_FAIL|'));
    if (hostFailures.length > 0) {
      throw new Error(
        `Failed to pin proxy host route(s) to the physical gateway: ${hostFailures
          .map((line) => line.slice('HOST_FAIL|'.length))
          .join('; ')}`,
      );
    }
  }

  /** Parses the enable script's stdout markers into teardown bookkeeping. */
  private recordEnabledRoutes(
    output: string,
    defaultRouteInterfaceIndex: number,
    tunInterfaceIndex: number,
  ): void {
    const lines = output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    for (const line of lines) {
      if (line.startsWith('HOST_CREATED|')) {
        const prefix = line.slice('HOST_CREATED|'.length);
        const destination = prefix.split('/')[0];
        this.addedRoutes.push({
          destination,
          mask: '255.255.255.255',
          interfaceIndex: defaultRouteInterfaceIndex,
          prefix,
        });
      } else if (line === 'DEFAULT4_CREATED') {
        this.addedRoutes.push({
          destination: '0.0.0.0',
          mask: '0.0.0.0',
          interfaceIndex: tunInterfaceIndex,
        });
      } else if (line === 'DEFAULT6_CREATED') {
        this.addedRoutes.push({
          destination: '::',
          mask: '::',
          interfaceIndex: tunInterfaceIndex,
          prefix: '::/0',
        });
      } else if (line.startsWith('TUN_ADDR_WARN|')) {
        logger.warn(
          'TunRouteService',
          'Could not set TUN address (Xray may have set it)',
          { error: line.slice('TUN_ADDR_WARN|'.length) },
        );
      } else if (line.startsWith('HOST_FAIL|')) {
        logger.warn('TunRouteService', 'Failed to add proxy host route', {
          detail: line.slice('HOST_FAIL|'.length),
        });
      }
    }
  }

  private async deleteRoute(route: AddedRoute): Promise<void> {
    const prefix =
      route.prefix ??
      (route.destination === '0.0.0.0'
        ? '0.0.0.0/0'
        : `${route.destination}/32`);
    await this.runPowerShell(deleteRouteScript(prefix, route.interfaceIndex), {
      allowNonZeroExit: true,
    });
  }

  private async cleanupStaleTunRoutes(
    options: StaleRouteCleanupOptions = {},
  ): Promise<void> {
    const { includeKnownServerHostRoutes = false } = options;
    const tunIndex = await this.getTunInterfaceIndex({
      timeoutMs: STALE_ROUTE_CLEANUP_TIMEOUT,
    });
    if (tunIndex != null) {
      await this.deleteRouteByPrefixAndMetric(
        '0.0.0.0/0',
        TUN_ROUTE_METRIC,
        tunIndex,
        { timeoutMs: STALE_ROUTE_CLEANUP_TIMEOUT },
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
      await this.deleteRouteByPrefixAndMetric(
        '::/0',
        TUN_ROUTE_METRIC,
        tunIndex,
        { timeoutMs: STALE_ROUTE_CLEANUP_TIMEOUT },
      ).catch((error) => {
        logger.warn(
          'TunRouteService',
          'Failed to cleanup stale TUN IPv6 default route',
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
        '0.0.0.0/0',
        { timeoutMs: STALE_ROUTE_CLEANUP_TIMEOUT },
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
      await this.deleteTunDefaultRoutesByNextHop(
        TUN_IPV6_NEXTHOP,
        TUN_ROUTE_METRIC,
        '::/0',
        { timeoutMs: STALE_ROUTE_CLEANUP_TIMEOUT },
      ).catch((error) => {
        logger.warn(
          'TunRouteService',
          'Failed to cleanup stale TUN IPv6 default routes by next hop',
          {
            nextHop: TUN_IPV6_NEXTHOP,
            error: error instanceof Error ? error.message : String(error),
          },
        );
      });
    }

    let knownServerIps: string[] = [];
    let removedHostRoutes = 0;
    if (includeKnownServerHostRoutes) {
      knownServerIps = await this.getKnownServerIps();
      try {
        removedHostRoutes = await this.deleteHostRoutesByPrefixesAndMetric(
          knownServerIps.map((ip) => this.hostPrefixForIp(ip)),
          1,
          { timeoutMs: STALE_ROUTE_CLEANUP_TIMEOUT },
        );
      } catch (error) {
        logger.warn('TunRouteService', 'Failed to cleanup stale host routes', {
          count: knownServerIps.length,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    logger.info('TunRouteService', 'Stale route cleanup finished', {
      removedHostRouteCandidates: knownServerIps.length,
      removedHostRoutes,
      checkedTunDefaultRoute: tunIndex != null,
      checkedKnownServerHostRoutes: includeKnownServerHostRoutes,
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
    options: RunPowerShellOptions = {},
  ): Promise<void> {
    await this.runPowerShell(
      deleteRouteByPrefixAndMetricScript(
        destinationPrefix,
        metric,
        interfaceIndex,
      ),
      { allowNonZeroExit: true, ...options },
    );
  }

  private async deleteTunDefaultRoutesByNextHop(
    nextHop: string,
    metric: number,
    destinationPrefix: string = '0.0.0.0/0',
    options: RunPowerShellOptions = {},
  ): Promise<void> {
    await this.runPowerShell(
      deleteTunDefaultRoutesByNextHopScript(nextHop, metric, destinationPrefix),
      { allowNonZeroExit: true, ...options },
    );
  }

  private async deleteHostRoutesByPrefixesAndMetric(
    destinationPrefixes: string[],
    metric: number,
    options: RunPowerShellOptions = {},
  ): Promise<number> {
    if (destinationPrefixes.length === 0) return 0;
    const out = await this.runPowerShell(
      deleteHostRoutesByPrefixesAndMetricScript(destinationPrefixes, metric),
      { allowNonZeroExit: true, ...options },
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
