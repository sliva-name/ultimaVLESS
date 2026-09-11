import net from 'net';
import os from 'os';
import { logger } from '@/main/services/LoggerService';
import {
  combineCommandOutput,
  runProcessWithOutput,
  type CommandOutput,
} from '@/main/services/platform/commandRunner';
import { TUN_INTERFACE_NAME, type DefaultRouteInfo } from './constants';

/**
 * Windows TUN routing without PowerShell for the connect hot path.
 *
 * `Get-NetRoute` & co. cost 0.8–2.5 s per PowerShell process (host start +
 * CDXML module compilation), and the connect path used to spawn two of them
 * before Xray could even start. `route.exe` and `netsh.exe` answer the same
 * questions in ~50–90 ms each. Their tables are parsed positionally on the
 * numeric columns only, so localized headers ("Активные маршруты", "Auf
 * Verbindung") never matter. Mutations are verified by re-reading the table
 * instead of trusting exit codes or localized status lines.
 */

export type CommandRunner = (
  command: string,
  args: string[],
) => Promise<CommandOutput>;

export const NATIVE_ROUTE_COMMAND_TIMEOUT_MS = 8000;

export const defaultCommandRunner: CommandRunner = (command, args) =>
  runProcessWithOutput(command, args, {
    timeoutMs: NATIVE_ROUTE_COMMAND_TIMEOUT_MS,
    windowsHide: true,
  });

export interface RoutePrintInterface {
  index: number;
  /** Lower-case, colon separated; null for MAC-less adapters (loopback, TUN, PPP). */
  mac: string | null;
  description: string;
}

export interface RoutePrintRoute {
  destination: string;
  netmask: string;
  gateway: string;
  /** Address of the interface the route uses (the "Interface" column). */
  interfaceAddress: string;
  /** Effective metric: route metric + interface metric, as Windows ranks them. */
  metric: number;
}

export interface ParsedRoutePrint {
  interfaces: RoutePrintInterface[];
  /** Gateway routes only; on-link rows carry no gateway and are skipped. */
  activeRoutes: RoutePrintRoute[];
}

export interface NetshDefaultRoute {
  gateway: string;
  interfaceIndex: number;
  routeMetric: number;
}

export interface HostInterface {
  name: string;
  address: string;
  mac: string | null;
  internal: boolean;
}

export interface HostRouteApplyResult {
  created: string[];
  failed: Array<{ prefix: string; message: string }>;
}

export interface HostRouteRemoveResult {
  removed: number;
  remaining: string[];
}

export interface WindowsNativeRouting {
  /** Best physical default gateway, or null when the tables could not be read. */
  discoverDefaultRoute(): Promise<DefaultRouteInfo | null>;
  /** Pin IPv4 `/32` prefixes to the gateway; stale pins for the same prefix are replaced. */
  addHostRoutes(params: {
    prefixes: string[];
    gateway: string;
    interfaceIndex: number;
    metric: number;
  }): Promise<HostRouteApplyResult>;
  /** Remove IPv4 `/32` pins regardless of which gateway they point at. */
  removeHostRoutes(prefixes: string[]): Promise<HostRouteRemoveResult>;
}

const IPV4 = String.raw`\d{1,3}(?:\.\d{1,3}){3}`;
const INTERFACE_LINE = new RegExp(
  String.raw`^\s*(\d+)\.{3}(?:((?:[0-9a-f]{2} ){5}[0-9a-f]{2}) )?\.*\s*(.*?)\s*$`,
  'i',
);
const ACTIVE_ROUTE_LINE = new RegExp(
  String.raw`^\s*(${IPV4})\s+(${IPV4})\s+(${IPV4})\s+(${IPV4})\s+(\d+)\s*$`,
);
const NETSH_DEFAULT_ROUTE_LINE = new RegExp(
  String.raw`(\d+)\s+0\.0\.0\.0/0\s+(\d+)\s+(${IPV4})\s*$`,
);
const HOST_MASK = '255.255.255.255';

/** Adapters that are almost never the real uplink even when they carry a default route. */
const VIRTUAL_ADAPTER_PATTERNS = [
  /^vEthernet/i,
  /^Default Switch/i,
  /Hyper-V/i,
  /VirtualBox/i,
  /VMware/i,
  /Loopback/i,
  /Teredo/i,
  /isatap/i,
];

const ZERO_MAC = '00:00:00:00:00:00';

function normalizeMac(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const mac = raw
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, ':');
  if (!/^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(mac) || mac === ZERO_MAC) {
    return null;
  }
  return mac;
}

export function parseRoutePrint(output: string): ParsedRoutePrint {
  const interfaces: RoutePrintInterface[] = [];
  const activeRoutes: RoutePrintRoute[] = [];
  for (const rawLine of output.split(/\r?\n/)) {
    const route = ACTIVE_ROUTE_LINE.exec(rawLine);
    if (route) {
      activeRoutes.push({
        destination: route[1],
        netmask: route[2],
        gateway: route[3],
        interfaceAddress: route[4],
        metric: Number(route[5]),
      });
      continue;
    }
    const iface = INTERFACE_LINE.exec(rawLine);
    if (iface && iface[3]) {
      interfaces.push({
        index: Number(iface[1]),
        mac: normalizeMac(iface[2]),
        description: iface[3],
      });
    }
  }
  return { interfaces, activeRoutes };
}

export function parseNetshDefaultRoutes(output: string): NetshDefaultRoute[] {
  const routes: NetshDefaultRoute[] = [];
  for (const line of output.split(/\r?\n/)) {
    const match = NETSH_DEFAULT_ROUTE_LINE.exec(line);
    if (match) {
      routes.push({
        routeMetric: Number(match[1]),
        interfaceIndex: Number(match[2]),
        gateway: match[3],
      });
    }
  }
  return routes;
}

export function listHostInterfaces(
  networkInterfaces: () => NodeJS.Dict<os.NetworkInterfaceInfo[]> = () =>
    os.networkInterfaces(),
): HostInterface[] {
  const result: HostInterface[] = [];
  for (const [name, entries] of Object.entries(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family !== 'IPv4') continue;
      result.push({
        name,
        address: entry.address,
        mac: normalizeMac(entry.mac),
        internal: entry.internal,
      });
    }
  }
  return result;
}

function isVirtualLike(name: string, description: string): boolean {
  return VIRTUAL_ADAPTER_PATTERNS.some(
    (pattern) => pattern.test(name) || pattern.test(description),
  );
}

function isTunAdapter(name: string, description: string): boolean {
  return (
    name === TUN_INTERFACE_NAME ||
    name.startsWith(`${TUN_INTERFACE_NAME} `) ||
    /wintun/i.test(description)
  );
}

function resolveInterfaceIndex(
  route: RoutePrintRoute,
  host: HostInterface | undefined,
  netshRoutes: NetshDefaultRoute[],
  interfaces: RoutePrintInterface[],
): number | null {
  // netsh lists the index next to each gateway; unique gateway = done.
  const byGateway = netshRoutes.filter((n) => n.gateway === route.gateway);
  if (byGateway.length === 1) {
    return byGateway[0].interfaceIndex;
  }
  // Two uplinks behind the same router: disambiguate through the adapter MAC
  // (`route print` lists it per index, Node reports it per address).
  if (host?.mac) {
    const byMac = interfaces.filter((iface) => iface.mac === host.mac);
    if (byMac.length === 1) {
      return byMac[0].index;
    }
    // A Hyper-V external switch clones the NIC's MAC: keep the one that netsh
    // actually shows carrying this gateway.
    const both = byMac.filter((iface) =>
      byGateway.some((n) => n.interfaceIndex === iface.index),
    );
    if (both.length === 1) {
      return both[0].index;
    }
  }
  return null;
}

/**
 * Picks the default route Windows itself would use for a fresh connection:
 * lowest effective metric, physical adapters before virtual switches, never
 * our own TUN adapter or a link-local/loopback address.
 */
export function selectDefaultRoute(input: {
  routePrint: ParsedRoutePrint;
  netshRoutes: NetshDefaultRoute[];
  hostInterfaces: HostInterface[];
}): DefaultRouteInfo | null {
  const candidates: Array<{
    info: DefaultRouteInfo;
    metric: number;
    virtual: boolean;
  }> = [];

  for (const route of input.routePrint.activeRoutes) {
    if (route.destination !== '0.0.0.0' || route.netmask !== '0.0.0.0') {
      continue;
    }
    if (route.gateway === '0.0.0.0') continue;
    if (
      route.interfaceAddress.startsWith('169.254.') ||
      route.interfaceAddress.startsWith('127.')
    ) {
      continue;
    }
    const host = input.hostInterfaces.find(
      (candidate) => candidate.address === route.interfaceAddress,
    );
    if (host?.internal) continue;
    const index = resolveInterfaceIndex(
      route,
      host,
      input.netshRoutes,
      input.routePrint.interfaces,
    );
    if (index === null) continue;
    const listed = input.routePrint.interfaces.find(
      (iface) => iface.index === index,
    );
    const description = listed?.description ?? '';
    const name = host?.name ?? (description || `Interface ${index}`);
    if (isTunAdapter(name, description)) continue;

    candidates.push({
      info: {
        interfaceIndex: index,
        gateway: route.gateway,
        interfaceName: name,
        localAddress: route.interfaceAddress,
      },
      metric: route.metric,
      virtual: isVirtualLike(name, description),
    });
  }

  candidates.sort(
    (left, right) =>
      Number(left.virtual) - Number(right.virtual) ||
      left.metric - right.metric,
  );
  return candidates[0]?.info ?? null;
}

/** `203.0.113.10/32` → `203.0.113.10`; null unless it is an IPv4 host prefix. */
export function hostAddressFromPrefix(prefix: string): string | null {
  const [address, length] = prefix.split('/');
  if (net.isIP(address) !== 4) return null;
  if (length !== undefined && length !== '32') return null;
  return address;
}

export function supportsNativeHostRoutes(prefixes: string[]): boolean {
  return (
    prefixes.length > 0 &&
    prefixes.every((prefix) => hostAddressFromPrefix(prefix) !== null)
  );
}

function firstMeaningfulLine(output: CommandOutput): string {
  const text = combineCommandOutput(output)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  return text ?? `exit code ${output.code ?? 'null'}`;
}

export function createWindowsNativeRouting(
  run: CommandRunner = defaultCommandRunner,
  networkInterfaces?: () => NodeJS.Dict<os.NetworkInterfaceInfo[]>,
): WindowsNativeRouting {
  const readActiveHostRoutes = async (): Promise<RoutePrintRoute[]> => {
    const output = await run('route', ['print', '-4']);
    return parseRoutePrint(output.stdout).activeRoutes.filter(
      (route) => route.netmask === HOST_MASK,
    );
  };

  return {
    async discoverDefaultRoute() {
      try {
        const [routePrint, netsh] = await Promise.all([
          run('route', ['print', '-4']),
          run('netsh', ['interface', 'ipv4', 'show', 'route']),
        ]);
        const selected = selectDefaultRoute({
          routePrint: parseRoutePrint(routePrint.stdout),
          netshRoutes: parseNetshDefaultRoutes(netsh.stdout),
          hostInterfaces: listHostInterfaces(networkInterfaces),
        });
        if (!selected) {
          logger.debug(
            'TunRouteService',
            'Native default route discovery found no candidate',
          );
        }
        return selected;
      } catch (error) {
        logger.warn(
          'TunRouteService',
          'Native default route discovery failed',
          {
            error: error instanceof Error ? error.message : String(error),
          },
        );
        return null;
      }
    },

    async addHostRoutes({ prefixes, gateway, interfaceIndex, metric }) {
      const attempts = new Map<
        string,
        { address: string; output: CommandOutput }
      >();
      for (const prefix of prefixes) {
        const address = hostAddressFromPrefix(prefix);
        if (address === null) {
          throw new Error(
            `Native host routes support IPv4 /32 only: ${prefix}`,
          );
        }
        // A pin left by a crashed session (or persisted by the old PowerShell
        // path) may point at a stale gateway; replace it wholesale.
        await run('route', ['DELETE', address, 'MASK', HOST_MASK]).catch(
          () => undefined,
        );
        const output = await run('route', [
          'ADD',
          address,
          'MASK',
          HOST_MASK,
          gateway,
          'METRIC',
          String(metric),
          'IF',
          String(interfaceIndex),
        ]);
        attempts.set(prefix, { address, output });
      }

      const present = await readActiveHostRoutes();
      const result: HostRouteApplyResult = { created: [], failed: [] };
      for (const [prefix, attempt] of attempts) {
        const pinned = present.some(
          (route) =>
            route.destination === attempt.address && route.gateway === gateway,
        );
        if (pinned) {
          result.created.push(prefix);
        } else {
          result.failed.push({
            prefix,
            message: firstMeaningfulLine(attempt.output),
          });
        }
      }
      return result;
    },

    async removeHostRoutes(prefixes) {
      const addresses = new Map<string, string>();
      for (const prefix of prefixes) {
        const address = hostAddressFromPrefix(prefix);
        if (address === null) {
          throw new Error(
            `Native host routes support IPv4 /32 only: ${prefix}`,
          );
        }
        addresses.set(prefix, address);
        await run('route', ['DELETE', address, 'MASK', HOST_MASK]).catch(
          () => undefined,
        );
      }
      const present = await readActiveHostRoutes();
      const remaining = [...addresses.entries()]
        .filter(([, address]) =>
          present.some((route) => route.destination === address),
        )
        .map(([prefix]) => prefix);
      return { removed: addresses.size - remaining.length, remaining };
    },
  };
}
