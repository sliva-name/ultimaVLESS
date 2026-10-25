import dns from 'dns';
import net from 'net';
import os from 'os';
import { VlessConfig } from '@/shared/types';
import type { NetworkAdapterList } from '@/shared/views/tunEnvironment';
import { unbracketIpv6 } from '@/shared/networkAddresses';
import { logger } from './LoggerService';
import { configService } from './ConfigService';
import { isElevatedOnWindows } from './PrivilegeService';
import {
  DefaultRouteInfo,
  DNS_TIMEOUT,
  SYSTEM_DNS_TIMEOUT,
} from './tunRoute/constants';
import { getDefaultRouteScript } from './tunRoute/windowsScripts';
import {
  runPowerShell as runPowerShellScript,
  RunPowerShellOptions,
} from './tunRoute/powerShellRunner';
import {
  createPlatformTunAdapter,
  PlatformTunAdapter,
} from './tunRoute/platformAdapter';
import {
  createFileTunRouteStateStore,
  createMemoryTunRouteStateStore,
  type TunRouteStateStore,
} from './tunRoute/routeStateStore';
import {
  createWindowsNativeRouting,
  supportsNativeHostRoutes,
  type WindowsNativeRouting,
} from './tunRoute/windowsNativeRouting';

export interface TunRoutingPlan {
  defaultRoute: DefaultRouteInfo;
  proxyIps: string[];
  /**
   * Windows: adapter alias for Xray's `autoOutboundsInterface` — the adapter
   * of the default route. Null leaves the choice to Xray.
   */
  outboundInterface?: string | null;
}

export interface TunRouteServiceOptions {
  /** Route bookkeeping that versions up to 7.19 persisted for crash recovery. */
  stateStore?: TunRouteStateStore;
  /** Route removal needs Administrator rights on Windows. */
  isElevated?: () => Promise<boolean>;
  /**
   * `route.exe`/`netsh` fast path for discovery. `null` forces discovery
   * through PowerShell (tests of that path; diagnostics).
   */
  nativeRouting?: WindowsNativeRouting | null;
  /** Adapter aliases as Node (and Xray) see them. */
  listInterfaceNames?: () => string[];
}

/**
 * TUN mode around Xray. Xray installs and removes the TUN routes itself
 * (`autoSystemRoutingTable`) and keeps its own connections, the one to the
 * server included, on the physical adapter (`autoOutboundsInterface`; on
 * Windows it also turns weak host send off there so the binding holds, see
 * `proxy/tun/tun_windows_outbound.go`). What is left on Windows: resolve the
 * server beforehand and name the adapter.
 */
export class TunRouteService {
  private readonly platformAdapter: PlatformTunAdapter;
  private readonly stateStore: TunRouteStateStore;
  private readonly isElevated: () => Promise<boolean>;
  private readonly nativeRouting: WindowsNativeRouting | null;
  private readonly listInterfaceNames: () => string[];

  constructor(
    private readonly platform: NodeJS.Platform = process.platform,
    options: TunRouteServiceOptions = {},
  ) {
    this.platformAdapter = createPlatformTunAdapter(platform);
    this.stateStore =
      options.stateStore ??
      (platform === 'win32'
        ? createFileTunRouteStateStore()
        : createMemoryTunRouteStateStore());
    this.isElevated = options.isElevated ?? isElevatedOnWindows;
    this.nativeRouting =
      options.nativeRouting === undefined
        ? platform === 'win32'
          ? createWindowsNativeRouting()
          : null
        : options.nativeRouting;
    this.listInterfaceNames =
      options.listInterfaceNames ?? (() => Object.keys(os.networkInterfaces()));
  }

  public isSupported(): boolean {
    return this.platformAdapter.isSupported();
  }

  public getUnsupportedReason(): string | null {
    return this.platformAdapter.getUnsupportedReason();
  }

  public getRouteMode(): string | null {
    return this.platformAdapter.getRouteMode();
  }

  public getDegradedReason(): string | null {
    return this.platformAdapter.getDegradedReason();
  }

  /**
   * Adapters the user can pin TUN to. Only Windows: elsewhere Xray already
   * follows the routing table when picking its outbound interface.
   */
  public async listNetworkAdapters(): Promise<NetworkAdapterList> {
    if (this.platform !== 'win32') {
      return { supported: false, adapters: [] };
    }
    const adapters = this.nativeRouting
      ? await this.nativeRouting.listAdapters()
      : [];
    return { supported: true, adapters };
  }

  /** User-selected TUN adapter (Windows), or null for automatic. */
  private getPreferredInterface(): string | null {
    if (this.platform !== 'win32') return null;
    return configService.getPerformanceSettings().tunOutboundInterface || null;
  }

  /**
   * Windows: the server's addresses and the adapter of the default route.
   * Xray looks an outbound's domain up through the Windows resolver, whose
   * queries go into the TUN and back into Xray, so the server is dialled by IP.
   */
  public async prepareRoutingPlan(
    config: VlessConfig,
  ): Promise<TunRoutingPlan> {
    const unsupportedReason = this.getUnsupportedReason();
    if (unsupportedReason) {
      throw new Error(unsupportedReason);
    }
    const preferred = this.getPreferredInterface();
    const [defaultRoute, proxyIps] = await Promise.all([
      this.getDefaultRouteQuick(preferred),
      this.resolveProxyAddresses(config.address),
    ]);

    if (!defaultRoute) {
      if (preferred) {
        throw new Error(
          `Network adapter "${preferred}" selected for TUN has no IPv4 default gateway ` +
            '(disconnected, or not an internet connection). Choose another adapter ' +
            'in Settings → Network or set it to Automatic.',
        );
      }
      throw new Error('Could not get default route. Check network connection.');
    }
    if (proxyIps.length === 0) {
      throw new Error(
        `Could not resolve proxy server address: ${config.address}`,
      );
    }

    return {
      defaultRoute,
      proxyIps,
      outboundInterface: this.resolveOutboundInterface(defaultRoute, preferred),
    };
  }

  /**
   * Xray's own pick prefers any Wi-Fi adapter with a default route over the
   * one Windows actually uses (`findOutboundInterface` in
   * `proxy/tun/tun_windows.go`), so it gets the adapter of the default route
   * instead — but only under a name Xray can resolve (Node and Xray both read
   * the adapter FriendlyName); anything else keeps Xray's own choice.
   */
  private resolveOutboundInterface(
    defaultRoute: DefaultRouteInfo,
    preferred: string | null,
  ): string | null {
    if (preferred) return preferred;
    const names = this.listInterfaceNames();
    if (names.includes(defaultRoute.interfaceName)) {
      return defaultRoute.interfaceName;
    }
    logger.warn(
      'TunRouteService',
      'Default route adapter has no resolvable name; Xray picks the TUN outbound adapter itself',
      { interfaceName: defaultRoute.interfaceName },
    );
    return null;
  }

  /**
   * Versions up to 7.19 pinned /32 routes to the server through the physical
   * gateway and recorded them so a crashed session could be undone. Removes
   * what such a session left behind: until the next reboot those routes would
   * keep sending traffic for the server to a gateway that may be gone. Skipped
   * (and left for an elevated instance) without the rights to remove routes.
   */
  public async recoverOrphanedRoutes(): Promise<void> {
    if (this.platform !== 'win32') {
      return;
    }
    const state = this.stateStore.read();
    if (!state) {
      return;
    }
    if (!(await this.isElevated())) {
      logger.info(
        'TunRouteService',
        'Orphaned TUN routes found; removal deferred to an elevated instance',
        { hostPrefixCount: state.hostPrefixes.length },
      );
      return;
    }
    // IPv6 pins and the old static mode's default routes needed PowerShell;
    // the latter went away with the TUN adapter. IPv6 ones last until reboot.
    const prefixes = state.hostPrefixes.filter((prefix) =>
      supportsNativeHostRoutes([prefix]),
    );
    if (this.nativeRouting && prefixes.length > 0) {
      try {
        const result = await this.nativeRouting.removeHostRoutes(prefixes);
        if (result.remaining.length > 0) {
          throw new Error(
            `Host route(s) still present after removal: ${result.remaining.join(', ')}`,
          );
        }
      } catch (error) {
        logger.warn('TunRouteService', 'Orphaned route recovery failed', {
          error: error instanceof Error ? error.message : String(error),
        });
        return;
      }
    }
    this.stateStore.clear();
    logger.info('TunRouteService', 'Recovered orphaned TUN routes', {
      hostPrefixes: prefixes,
      skipped: state.hostPrefixes.length - prefixes.length,
    });
  }

  // ---- Windows route discovery ---------------------------------------------

  private async getDefaultRoute(
    preferredInterface: string | null = null,
  ): Promise<DefaultRouteInfo | null> {
    if (this.nativeRouting) {
      const native = await this.nativeRouting.discoverDefaultRoute(
        preferredInterface ?? undefined,
      );
      if (native) {
        return native;
      }
      logger.info(
        'TunRouteService',
        'Falling back to PowerShell for default route discovery',
        { preferredInterface },
      );
    }
    const out = await this.runPowerShell(
      getDefaultRouteScript(preferredInterface ?? undefined),
      { allowNonZeroExit: true },
    );
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

  /** One probe and one quick retry: a route can flap right after wake-up. */
  private async getDefaultRouteQuick(
    preferredInterface: string | null = null,
  ): Promise<DefaultRouteInfo | null> {
    const first = await this.getDefaultRoute(preferredInterface);
    if (first) return first;
    await this.sleep(150);
    return this.getDefaultRoute(preferredInterface);
  }

  // ---- DNS ------------------------------------------------------------------

  private async resolveProxyAddresses(rawAddress: string): Promise<string[]> {
    // Servers saved by earlier builds may still hold `[ipv6]`.
    const address = unbracketIpv6(rawAddress);
    if (net.isIP(address) !== 0) return [address];

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
      const systemIpv4 = systemIps.filter((ip) => net.isIP(ip) === 4);
      if (systemIpv4.length > 0) {
        return systemIpv4;
      }
      if (systemIps.length > 0) {
        return systemIps;
      }
    } catch {
      // Fall through to public resolvers.
    }

    // Each lookup gets its own budget; a shared timer would leave the AAAA
    // fallback with whatever the A query did not use.
    const resolver = new dns.promises.Resolver();
    resolver.setServers(['1.1.1.1', '8.8.8.8']);
    const ipv4 = await this.withTimeout(
      resolver.resolve4(address),
      DNS_TIMEOUT,
    ).catch((): string[] => []);
    if (ipv4.length > 0) {
      return [...new Set(ipv4)];
    }
    // IPv6-only hosts have no A records; fall back to AAAA.
    const ipv6 = await this.withTimeout(
      resolver.resolve6(address),
      DNS_TIMEOUT,
    ).catch((): string[] => []);
    return [...new Set(ipv6)];
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

  // ---- PowerShell runner ---------------------------------------------------
  // Kept as an instance method so tests can spy on it via `service as any`.

  private runPowerShell(
    script: string,
    options: RunPowerShellOptions = {},
  ): Promise<string> {
    return runPowerShellScript(script, options);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const tunRouteService = new TunRouteService();
