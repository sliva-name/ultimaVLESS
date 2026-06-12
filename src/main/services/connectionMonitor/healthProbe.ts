import os from 'os';
import { APP_CONSTANTS } from '@/shared/constants';
import type { XrayHealthStatus } from '@/shared/ipc';
import type { ConnectionMode } from '@/shared/types';
import {
  probeDirectInternetConnectivity,
  probeHttpThroughProxy,
  probeTcpPort,
} from '../networkProbe';
import {
  TUN_ADDRESS,
  TUN_INTERFACE_NAME,
} from '../tunRoute/constants';

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
}

/**
 * In TUN mode a direct HTTP probe is useless (it would be routed through the
 * tunnel itself), so host connectivity is approximated by the presence of a
 * usable non-TUN IPv4 interface. When the physical link drops, Windows
 * removes the DHCP address (or falls back to APIPA 169.254.x.x).
 */
export function hasUsableHostNetworkInterface(): boolean {
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
        return true;
      }
    }
  }
  return false;
}

function getXrayFailureReason(xrayState: XrayHealthStatus): string {
  return (
    xrayState.lastFailureReason ||
    xrayState.lastReadinessError ||
    'Xray reported failed health status'
  );
}

export async function runConnectionHealthProbe({
  getXrayHealthStatus,
  connectionMode,
  tunnelProbe,
}: RunConnectionHealthProbeOptions): Promise<ConnectionHealthProbeResult> {
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
    probeTcpPort(APP_CONSTANTS.PORTS.SOCKS),
    probeTcpPort(APP_CONSTANTS.PORTS.HTTP),
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
    APP_CONSTANTS.PORTS.HTTP,
    '127.0.0.1',
    tunnelProbe?.timeoutMs ?? 10_000,
    tunnelProbe?.attempts ?? 3,
    tunnelProbe?.gapMs ?? 350,
  );
  if (!tunnelOk) {
    const hostOffline =
      connectionMode === 'tun'
        ? !hasUsableHostNetworkInterface()
        : !(await probeDirectInternetConnectivity());
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
