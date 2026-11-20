import {
  RealDelayService as DesktopRealDelayService,
  type DelayTestProcess,
  type DelayTestProxy,
  type RealDelayServiceOptions,
} from '@desktop/main/services/RealDelayService';
import type { XrayConfig } from '@/shared/xray-types';
import { logger } from './LoggerService';
import { UltimaCore } from '../native/UltimaCore';
import { adaptConfigForAndroid } from '../backend/androidConfig';

export {
  REAL_DELAY_MIN_TIMEOUT_MS,
  REAL_DELAY_TEST_URL,
  buildDelayTestConfig,
} from '@desktop/main/services/RealDelayService';
export type { DelayTestProcess, DelayTestProxy, RealDelayServiceOptions };

/**
 * The desktop measurement (CONNECT, then two GETs on the same tunnel, the
 * second one reported) needs a raw socket the WebView does not have, so the
 * native side runs it.
 */
export function measureTunnelDelay(
  proxy: DelayTestProxy,
  url: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<number | null> {
  if (signal?.aborted) return Promise.resolve(null);
  return new Promise((resolve) => {
    const onAbort = (): void => resolve(null);
    signal?.addEventListener('abort', onAbort, { once: true });
    UltimaCore.tunnelDelay({
      proxyPort: proxy.port,
      user: proxy.user,
      pass: proxy.pass,
      url,
      timeoutMs,
    })
      .then(
        ({ latency }) => latency ?? null,
        (error: unknown) => {
          logger.debug('RealDelayService', 'Tunnel delay failed', {
            error: error instanceof Error ? error.message : String(error),
          });
          return null;
        },
      )
      .then((latency) => {
        signal?.removeEventListener('abort', onAbort);
        resolve(signal?.aborted ? null : latency);
      });
  });
}

let nextProbeId = 0;

/**
 * Desktop spawns a throwaway Xray process per probe; here the throwaway core
 * runs in the app process. The probe config, the readiness wait and the timed
 * request through it are the desktop ones.
 */
function startProbeCore(config: XrayConfig): DelayTestProcess {
  nextProbeId += 1;
  const id = `delay-${nextProbeId}`;
  let resolveExited!: () => void;
  const exited = new Promise<void>((resolve) => {
    resolveExited = resolve;
  });
  let killed = false;
  const started = UltimaCore.startProbeCore({
    id,
    config: JSON.stringify(adaptConfigForAndroid(config, 'proxy')),
  }).catch((error: unknown) => {
    logger.debug('RealDelayService', 'Probe core failed to start', {
      error: error instanceof Error ? error.message : String(error),
    });
    resolveExited();
  });
  return {
    exited,
    kill: () => {
      if (killed) return;
      killed = true;
      void started
        .then(() => UltimaCore.stopProbeCore({ id }))
        .catch(() => undefined)
        .finally(resolveExited);
    },
  };
}

export class RealDelayService extends DesktopRealDelayService {
  constructor(options: RealDelayServiceOptions = {}) {
    super({
      spawnXray: startProbeCore,
      allocatePort: async () => (await UltimaCore.allocatePort()).port,
      measure: measureTunnelDelay,
      // Each probe core shares the app's memory with the VPN itself.
      maxConcurrent: 4,
      ...options,
    });
  }
}
