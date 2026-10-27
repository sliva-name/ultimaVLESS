import {
  RealDelayService as DesktopRealDelayService,
  type DelayTestProcess,
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
  measureHttpThroughProxy,
} from '@desktop/main/services/RealDelayService';
export type { DelayTestProcess, RealDelayServiceOptions };

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
    config: JSON.stringify(adaptConfigForAndroid(config)),
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
      // Each probe core shares the app's memory with the VPN itself.
      maxConcurrent: 4,
      ...options,
    });
  }
}
