import { logger } from '@/main/services/LoggerService';

export interface WaitForProcessExitTarget {
  pid?: number | null;
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  once(event: 'close' | 'error', listener: () => void): unknown;
  off?(event: 'close' | 'error', listener: () => void): unknown;
  removeListener?(event: 'close' | 'error', listener: () => void): unknown;
}

export const DEFAULT_PROCESS_EXIT_KILL_GRACE_MS = 1_000;

/**
 * Resolves when the child exits, or after SIGKILL + a short grace period.
 * Without the grace resolve, a child that never emits `close` after kill
 * (hung handle, elevated wrapper) blocks every later start/switch forever.
 */
export function waitForProcessExit(
  processRef: WaitForProcessExitTarget,
  kill: (processRef: WaitForProcessExitTarget) => void,
  options: { timeoutMs: number; killGraceMs?: number },
): Promise<void> {
  return new Promise((resolve) => {
    if (processRef.exitCode != null || processRef.signalCode != null) {
      resolve();
      return;
    }
    let settled = false;
    let timeoutId: NodeJS.Timeout | null = null;
    type ProcessEventHandler = () => void;

    const cleanup = (
      onClose: ProcessEventHandler,
      onError: ProcessEventHandler,
    ): void => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      if (typeof processRef.off === 'function') {
        processRef.off('close', onClose);
        processRef.off('error', onError);
        return;
      }
      if (typeof processRef.removeListener === 'function') {
        processRef.removeListener('close', onClose);
        processRef.removeListener('error', onError);
      }
    };

    const finish = (
      onClose: ProcessEventHandler,
      onError: ProcessEventHandler,
    ): void => {
      if (settled) return;
      settled = true;
      cleanup(onClose, onError);
      resolve();
    };

    const onClose = () => finish(onClose, onError);
    const onError = () => finish(onClose, onError);

    processRef.once('close', onClose);
    processRef.once('error', onError);
    timeoutId = setTimeout(() => {
      logger.warn(
        'XrayService',
        'Timed out waiting for Xray to exit, sending SIGKILL',
        {
          timeoutMs: options.timeoutMs,
          pid: processRef.pid ?? null,
        },
      );
      kill(processRef);
      const killGraceMs =
        options.killGraceMs ?? DEFAULT_PROCESS_EXIT_KILL_GRACE_MS;
      timeoutId = setTimeout(() => {
        logger.warn(
          'XrayService',
          'Xray did not exit after SIGKILL, continuing',
          { pid: processRef.pid ?? null },
        );
        finish(onClose, onError);
      }, killGraceMs);
    }, options.timeoutMs);
  });
}
