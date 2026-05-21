import { APP_CONSTANTS } from '@/shared/constants';
import type { XrayHealthStatus } from '@/shared/ipc';
import {
  probeDirectInternetConnectivity,
  probeHttpThroughProxy,
  probeTcpPort,
} from '../networkProbe';

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

interface RunConnectionHealthProbeOptions {
  getXrayHealthStatus: () => XrayHealthStatus;
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

  const tunnelOk = await probeHttpThroughProxy(APP_CONSTANTS.PORTS.HTTP);
  if (!tunnelOk) {
    const hostOnline = await probeDirectInternetConnectivity();
    if (!hostOnline) {
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
