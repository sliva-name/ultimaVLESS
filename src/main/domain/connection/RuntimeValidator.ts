import { APP_CONSTANTS } from '@/shared/constants';
import type { XrayHealthStatus } from '@/shared/ipc';
import {
  probeCoreListeners,
  probeTrafficThroughCore,
} from '@/main/services/coreProbe';
import { logger } from '@/main/services/LoggerService';
import { throwIfAborted } from './abort';
import type { ConnectionSpec } from './ConnectionSpec';

const DEFAULT_TIMEOUT_MS = 6_000;
const DEFAULT_ATTEMPTS = 2;

export interface RuntimeValidator {
  validate(spec: ConnectionSpec, signal?: AbortSignal): Promise<boolean>;
}

export function createRuntimeValidator(deps: {
  getXrayHealthStatus: () => XrayHealthStatus;
  timeoutMs?: number;
  attempts?: number;
}): RuntimeValidator {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const attempts = deps.attempts ?? DEFAULT_ATTEMPTS;

  return {
    async validate(
      spec: ConnectionSpec,
      signal?: AbortSignal,
    ): Promise<boolean> {
      throwIfAborted(signal);
      const listenersReady = await probeCoreListeners(
        spec.ports,
        timeoutMs,
        signal,
      );
      throwIfAborted(signal);

      if (!listenersReady) {
        logger.warn(
          'RuntimeValidator',
          'Local proxy listeners are unreachable',
          { mode: spec.mode },
        );
        return false;
      }

      const xrayHealth = deps.getXrayHealthStatus();
      if (xrayHealth.state === 'failed') {
        logger.warn('RuntimeValidator', 'Xray health validation failed', {
          mode: spec.mode,
          failureReason:
            xrayHealth.lastFailureReason || xrayHealth.lastReadinessError,
        });
        return false;
      }

      const tunnelOk = await probeTrafficThroughCore(
        {
          socks: spec.ports.socks,
          http: spec.ports.http || APP_CONSTANTS.PORTS.HTTP,
        },
        { timeoutMs, attempts, gapMs: 0, signal },
      );
      throwIfAborted(signal);
      if (!tunnelOk) {
        logger.warn('RuntimeValidator', 'Traffic validation failed', {
          mode: spec.mode,
        });
      }
      return tunnelOk;
    },
  };
}
