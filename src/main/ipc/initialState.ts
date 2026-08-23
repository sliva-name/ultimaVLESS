import { BrowserWindow } from 'electron';
import { logger } from '@/main/services/LoggerService';
import { PerfTimer } from '@/shared/perfMetrics';
import { activeServerIdFromState } from '@/main/domain/connection/ConnectionState';
import type { SnapshotReason } from '@/main/runtime/SnapshotPublisher';

/** Defer subscription refresh slightly so first paint is not blocked. */
const SUBSCRIPTION_REFRESH_DEFER_MS = 800;
import { IpcDependencies } from './dependencies';

interface InitialStateDeps {
  configService: IpcDependencies['configService'];
  subscriptionRepository: IpcDependencies['subscriptionRepository'];
  createRuntimeDependencies: () => IpcDependencies;
  stopAutoRefreshTimer: () => void;
}

interface InitialStateActions {
  notifySnapshot: (reason?: SnapshotReason) => void;
  queueRefreshAllSubscriptions: (manualLinks: string) => Promise<{
    configCount: number;
    reason?: string;
    partialErrors?: string[];
  }>;
  reportSubscriptionRefreshIssue: (reason: string) => void;
  restartAutoRefreshTimer: () => void;
  attemptPendingTunReconnect: (
    serverId: string,
    deps: IpcDependencies,
    options?: { emitErrorOnFailure: boolean },
  ) => Promise<boolean>;
}

export async function loadInitialState(
  _window: BrowserWindow,
  actions: InitialStateActions,
  deps: InitialStateDeps,
): Promise<void> {
  logger.info('IPC', 'loadInitialState called');
  const runtimeDeps = deps.createRuntimeDependencies();

  const subscriptions = deps.subscriptionRepository.list();
  const manualLinks = deps.subscriptionRepository.getManualLinks();
  const pendingTunReconnectServerId =
    deps.configService.consumePendingTunReconnect();

  logger.info('IPC', 'loadInitialState', {
    subscriptionCount: subscriptions.length,
    enabledCount: subscriptions.filter((s) => s.enabled).length,
    hasManualLinks: !!manualLinks,
    hasPendingTunReconnect: !!pendingTunReconnectServerId,
  });

  actions.notifySnapshot('bootstrap');

  const hasInput = subscriptions.some((s) => s.enabled) || !!manualLinks.trim();
  const attemptPendingReconnectAfterRefresh = async (): Promise<void> => {
    if (!pendingTunReconnectServerId) return;
    const reconnectServerId =
      deps.configService.getSelectedServerId() ?? pendingTunReconnectServerId;
    await actions.attemptPendingTunReconnect(reconnectServerId, runtimeDeps, {
      emitErrorOnFailure: true,
    });
  };
  const handleRefreshResult = (result: {
    configCount: number;
    reason?: string;
    partialErrors?: string[];
  }): void => {
    if (result.configCount === 0) {
      actions.reportSubscriptionRefreshIssue(
        result.reason || 'No valid configuration links were found',
      );
    } else if (result.partialErrors && result.partialErrors.length > 0) {
      logger.warn('IPC', 'Some subscriptions failed on initial load', {
        errors: result.partialErrors,
      });
    }
  };

  if (hasInput) {
    const refreshDeferMs = pendingTunReconnectServerId
      ? 0
      : SUBSCRIPTION_REFRESH_DEFER_MS;
    const refreshJob = new Promise<{
      configCount: number;
      reason?: string;
      partialErrors?: string[];
    }>((resolve, reject) => {
      const runRefresh = () => {
        const timer = new PerfTimer('IPC', 'initial subscription refresh');
        actions
          .queueRefreshAllSubscriptions(manualLinks)
          .then((result) => {
            timer.end({ configCount: result.configCount });
            resolve(result);
          })
          .catch((error) => {
            timer.end({ failed: true });
            reject(error);
          });
      };
      if (refreshDeferMs > 0) {
        setTimeout(runRefresh, refreshDeferMs);
      } else {
        runRefresh();
      }
    });
    const refreshCompletion = refreshJob
      .then(handleRefreshResult)
      .catch((error) => {
        const reason = error instanceof Error ? error.message : String(error);
        actions.reportSubscriptionRefreshIssue(reason);
      });

    if (pendingTunReconnectServerId) {
      void refreshCompletion
        .then(async () => {
          const controller = runtimeDeps.connectionController;
          const alreadyConnected =
            controller.getPhase() === 'connected' &&
            (activeServerIdFromState(controller.getConnectionState()) ===
              pendingTunReconnectServerId ||
              activeServerIdFromState(controller.getConnectionState()) ===
                deps.configService.getSelectedServerId());
          if (alreadyConnected) {
            logger.info(
              'IPC',
              'Skipping pending TUN reconnect retry: already connected',
              {
                serverId: pendingTunReconnectServerId.substring(0, 8),
              },
            );
            return;
          }
          await attemptPendingReconnectAfterRefresh();
        })
        .catch((error) => {
          logger.error(
            'IPC',
            'Pending TUN reconnect retry after refresh failed',
            error,
          );
        });
    }
    actions.restartAutoRefreshTimer();
  } else {
    logger.info('IPC', 'No enabled subscriptions or manual links saved');
    deps.stopAutoRefreshTimer();
    void attemptPendingReconnectAfterRefresh().catch((error) => {
      logger.error(
        'IPC',
        'Pending TUN reconnect without refresh failed',
        error,
      );
    });
  }
}
