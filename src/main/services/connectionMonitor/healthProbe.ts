import os from 'os';
import { APP_CONSTANTS } from '@/shared/constants';
import type { XrayHealthStatus } from '@/shared/ipc';
import type { ConnectionMode } from '@/shared/types';
import {
  probeDirectInternetConnectivity,
  probeHttpThroughProxy,
  probeInternetFromLocalAddresses,
  probeTcpPort,
} from '../networkProbe';
import { TUN_ADDRESS, TUN_INTERFACE_NAME } from '../tunRoute/constants';

export type ConnectionHealthProbeResult =
  | {
      type: 'xray-failed';
      localProxyReachable: boolean;
      failureReason: string;
      xrayState: XrayHealthStatus;
    }
  | {
      type: 'local-proxy-failed';
      localProxyReachable: false;
      failureReason: string;
      xrayState: XrayHealthStatus;
    }
  | {
      type: 'tunnel-failed';
      localProxyReachable: true;
      failureReason: string;
    }
  | {
      type: 'host-offline';
      localProxyReachable: true;
      failureReason: string;
    }
  | {
      type: 'healthy';
      localProxyReachable: true;
    };

interface TunnelProbeOptions {
  timeoutMs: number;
  attempts: number;
  gapMs: number;
}

interface RunConnectionHealthProbeOptions {
  getXrayHealthStatus: () => XrayHealthStatus;
  connectionMode: ConnectionMode;
  tunnelProbe?: TunnelProbeOptions;
  ports?: { socks: number; http: number };
  signal?: AbortSignal;
}

/**
 * IPv4 addresses of the non-TUN adapters. When the physical link drops,
 * Windows removes the DHCP address (or falls back to APIPA 169.254.x.x).
 */
export function listHostIpv4Addresses(): string[] {
  const result: string[] = [];
  const interfaces = os.networkInterfaces();
  for (const [name, addresses] of Object.entries(interfaces)) {
    if (!addresses || name.startsWith(TUN_INTERFACE_NAME)) {
      continue;
    }
    for (const address of addresses) {
      if (
        address.family === 'IPv4' &&
        !address.internal &&
        !address.address.startsWith('169.254.') &&
        address.address !== TUN_ADDRESS
      ) {
        result.push(address.address);
      }
    }
  }
  return result;
}

function getXrayFailureReason(xrayState: XrayHealthStatus): string {
  return (
    xrayState.lastFailureReason ||
    xrayState.lastReadinessError ||
    'Xray reported failed health status'
  );
}

/**
 * In TUN mode a plain direct probe is useless: it would be routed through the
 * tunnel itself. An adapter can keep its address while its uplink is gone
 * (Wi-Fi, ISP), so on Windows the probe is bound to the adapters' own
 * addresses and leaves past TUN. Elsewhere a bound socket is still routed by
 * destination only, so the adapter having an address is all we can tell.
 */
export async function isHostInternetUnavailable(
  connectionMode: ConnectionMode,
  platform: NodeJS.Platform = process.platform,
): Promise<boolean> {
  if (connectionMode !== 'tun') {
    return !(await probeDirectInternetConnectivity());
  }
  const addresses = listHostIpv4Addresses();
  if (addresses.length === 0) {
    return true;
  }
  if (platform !== 'win32') {
    return false;
  }
  return !(await probeInternetFromLocalAddresses(addresses));
}

export async function runConnectionHealthProbe({
  getXrayHealthStatus,
  connectionMode,
  tunnelProbe,
  ports,
  signal,
}: RunConnectionHealthProbeOptions): Promise<ConnectionHealthProbeResult> {
  const socksPort = ports?.socks ?? APP_CONSTANTS.PORTS.SOCKS;
  const httpPort = ports?.http ?? APP_CONSTANTS.PORTS.HTTP;
  const initialXrayState = getXrayHealthStatus();
  if (initialXrayState.state === 'failed') {
    return {
      type: 'xray-failed',
      localProxyReachable: initialXrayState.localProxyReachable === true,
      failureReason: getXrayFailureReason(initialXrayState),
      xrayState: initialXrayState,
    };
  }

  const [socksReady, httpReady] = await Promise.all([
    probeTcpPort(socksPort, '127.0.0.1', 1500, signal),
    probeTcpPort(httpPort, '127.0.0.1', 1500, signal),
  ]);

  if (!socksReady || !httpReady) {
    const xrayState = getXrayHealthStatus();
    return {
      type: 'local-proxy-failed',
      localProxyReachable: false,
      failureReason:
        xrayState.lastReadinessError || 'Local proxy listeners are unreachable',
      xrayState,
    };
  }

  const tunnelOk = await probeHttpThroughProxy(
    httpPort,
    '127.0.0.1',
    tunnelProbe?.timeoutMs ?? 10_000,
    tunnelProbe?.attempts ?? 3,
    tunnelProbe?.gapMs ?? 350,
    signal,
  );
  if (!tunnelOk) {
    const hostOffline = await isHostInternetUnavailable(connectionMode);
    if (hostOffline) {
      return {
        type: 'host-offline',
        localProxyReachable: true,
        failureReason:
          'Host internet connectivity is unavailable; auto-switch is deferred',
      };
    }

    return {
      type: 'tunnel-failed',
      localProxyReachable: true,
      failureReason:
        'Remote endpoint check via proxy failed after retries (tunnel may be slow or blocked)',
    };
  }

  return {
    type: 'healthy',
    localProxyReachable: true,
  };
}
