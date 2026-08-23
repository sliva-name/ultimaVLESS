import { logger } from '@/main/services/LoggerService';
import type { IpcDependencies } from '@/main/ipc/dependencies';
import type { SnapshotPublisher } from './SnapshotPublisher';

export interface ConnectionRecovery {
  handleUnexpectedXrayExit: (reason: string) => Promise<void>;
  attemptPendingTunReconnect: (options?: {
    emitErrorOnFailure: boolean;
  }) => Promise<boolean>;
}

export function createConnectionRecovery(
  deps: IpcDependencies,
  snapshotPublisher: SnapshotPublisher,
): ConnectionRecovery {
  let unexpectedXrayExitRecovery: Promise<void> | null = null;

  const handlePendingTunReconnectFailure = async (
    error: unknown,
    emitErrorOnFailure: boolean,
  ): Promise<false> => {
    logger.error('IPC', 'Pending TUN reconnect failed', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    try {
      await deps.connectionController.cleanupAfterFailure(errorMessage);
    } catch (cleanupError) {
      logger.error(
        'IPC',
        'Failed to cleanup network stack after pending reconnect failure',
        cleanupError,
      );
    }

    if (emitErrorOnFailure) {
      snapshotPublisher.push('recovery');
    }
    return false;
  };

  const handleUnexpectedXrayExit = async (reason: string): Promise<void> => {
    if (unexpectedXrayExitRecovery) {
      return unexpectedXrayExitRecovery;
    }

    const phase = deps.connectionController.getPhase();
    if (phase !== 'connected') {
      return;
    }

    unexpectedXrayExitRecovery = (async () => {
      const message = `Connection lost: ${reason}`;
      logger.error('IPC', 'Handling unexpected Xray exit', {
        reason,
        phase,
      });
      try {
        await deps.connectionController.handleRuntimeFailure(message, {
          localProxyReachable: false,
        });
        snapshotPublisher.push('recovery');
      } catch (error) {
        logger.error(
          'IPC',
          'Failed to recover after unexpected Xray exit',
          error,
        );
      } finally {
        unexpectedXrayExitRecovery = null;
      }
    })();

    return unexpectedXrayExitRecovery;
  };

  const attemptPendingTunReconnect = async (
    options: { emitErrorOnFailure: boolean } = { emitErrorOnFailure: true },
  ): Promise<boolean> => {
    try {
      return await deps.connectionController.resumePendingTunAfterRelaunch();
    } catch (error) {
      return handlePendingTunReconnectFailure(
        error,
        options.emitErrorOnFailure,
      );
    }
  };

  return {
    handleUnexpectedXrayExit,
    attemptPendingTunReconnect,
  };
}
