import { BrowserWindow } from 'electron';
import { logger } from '@/main/services/LoggerService';
import { PerfTimer } from '@/shared/perfMetrics';
import type { SnapshotReason } from '@/main/runtime/SnapshotPublisher';
import { IpcDependencies } from './dependencies';

/** Defer subscription refresh slightly so first paint is not blocked. */
const SUBSCRIPTION_REFRESH_DEFER_MS = 800;

interface InitialStateDeps {
  configService: IpcDependencies['configService'];
  subscriptionRepository: IpcDependencies['subscriptionRepository'];
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
  attemptPendingTunReconnect: () => Promise<boolean>;
}

export async function loadInitialState(
  _window: BrowserWindow,
  actions: InitialStateActions,
  deps: InitialStateDeps,
): Promise<void> {
  logger.info('IPC', 'loadInitialState called');

  const subscriptions = deps.subscriptionRepository.list();
  const manualLinks = deps.subscriptionRepository.getManualLinks();
  const pendingTunReconnect = !!deps.configService.peekPendingTunReconnect();

  logger.info('IPC', 'loadInitialState', {
    subscriptionCount: subscriptions.length,
    enabledCount: subscriptions.filter((s) => s.enabled).length,
    hasManualLinks: !!manualLinks,
    hasPendingTunReconnect: pendingTunReconnect,
  });

  actions.notifySnapshot('bootstrap');

  const hasInput = subscriptions.some((s) => s.enabled) || !!manualLinks.trim();
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

  if (!hasInput) {
    logger.info('IPC', 'No enabled subscriptions or manual links saved');
    deps.stopAutoRefreshTimer();
    void actions.attemptPendingTunReconnect().catch((error) => {
      logger.error(
        'IPC',
        'Pending TUN reconnect without refresh failed',
        error,
      );
    });
    return;
  }

  const refreshDeferMs = pendingTunReconnect ? 0 : SUBSCRIPTION_REFRESH_DEFER_MS;
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

  void refreshJob
    .then(handleRefreshResult)
    .catch((error) => {
      const reason = error instanceof Error ? error.message : String(error);
      actions.reportSubscriptionRefreshIssue(reason);
    })
    .then(() => actions.attemptPendingTunReconnect())
    .catch((error) => {
      logger.error(
        'IPC',
        'Pending TUN reconnect retry after refresh failed',
        error,
      );
    });
  actions.restartAutoRefreshTimer();
}
