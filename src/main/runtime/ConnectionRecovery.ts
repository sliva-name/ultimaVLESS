import { logger } from '@/main/services/LoggerService';
import type { IpcDependencies } from '@/main/ipc/dependencies';
import type { SnapshotPublisher } from './SnapshotPublisher';

export interface ConnectionRecovery {
  handleUnexpectedXrayExit: (reason: string) => Promise<void>;
  attemptPendingTunReconnect: (
    serverId: string,
    options?: { emitErrorOnFailure: boolean },
  ) => Promise<boolean>;
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
    try {
      await deps.connectionController.cleanupAfterFailure();
    } catch (cleanupError) {
      logger.error(
        'IPC',
        'Failed to cleanup network stack after pending reconnect failure',
        cleanupError,
      );
    }

    if (emitErrorOnFailure) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      deps.connectionMonitorService.recordError(errorMessage);
      snapshotPublisher.push('recovery');
    }
    return false;
  };

  const handleUnexpectedXrayExit = async (reason: string): Promise<void> => {
    if (unexpectedXrayExitRecovery) {
      return unexpectedXrayExitRecovery;
    }

    const monitorStatus = deps.connectionMonitorService.getStatus();
    if (!monitorStatus.isConnected || !monitorStatus.currentServer) {
      return;
    }

    unexpectedXrayExitRecovery = (async () => {
      const message = `Connection lost: ${reason}`;
      logger.error('IPC', 'Handling unexpected Xray exit', {
        reason,
        serverId: monitorStatus.currentServer?.uuid.substring(0, 8),
      });
      try {
        const autoSwitchScheduled =
          deps.connectionMonitorService.handleCriticalConnectionFailure(
            message,
            {
              localProxyReachable: false,
            },
          );
        if (!autoSwitchScheduled) {
          deps.connectionMonitorService.handleUnexpectedDisconnect(message);
        }
        snapshotPublisher.push('recovery');
        await deps.connectionController.cleanupAfterFailure();
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
    serverId: string,
    options: { emitErrorOnFailure: boolean } = { emitErrorOnFailure: true },
  ): Promise<boolean> => {
    try {
      return await deps.connectionController.resumePendingTun(serverId);
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
