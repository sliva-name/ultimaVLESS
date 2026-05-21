import { APP_CONSTANTS } from '@/shared/constants';
import type { XrayHealthStatus } from '@/shared/ipc';
import { probeHttpThroughProxy, probeTcpPort } from '../networkProbe';

export type ConnectionHealthProbeResult =
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
      type: 'healthy';
      localProxyReachable: true;
    };

interface RunConnectionHealthProbeOptions {
  getXrayHealthStatus: () => XrayHealthStatus;
}

export async function runConnectionHealthProbe({
  getXrayHealthStatus,
}: RunConnectionHealthProbeOptions): Promise<ConnectionHealthProbeResult> {
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
