import { BrowserWindow } from 'electron';
import { logger } from '@/main/services/LoggerService';
import { PerfTimer } from '@/shared/perfMetrics';
import type { SnapshotReason } from '@/main/runtime/SnapshotPublisher';
import { isElevatedRelaunch } from '@/main/runtime/launchArgs';
import { IpcDependencies } from './dependencies';

/** Defer subscription refresh slightly so first paint is not blocked. */
const SUBSCRIPTION_REFRESH_DEFER_MS = 800;

interface InitialStateDeps {
  configService: IpcDependencies['configService'];
  subscriptionRepository: IpcDependencies['subscriptionRepository'];
  stopAutoRefreshTimer: () => void;
  /** Injected for tests; production reads `process.argv`. */
  relaunchedElevated?: boolean;
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

type RefreshResult = {
  configCount: number;
  reason?: string;
  partialErrors?: string[];
};

export async function loadInitialState(
  _window: BrowserWindow,
  actions: InitialStateActions,
  deps: InitialStateDeps,
): Promise<void> {
  logger.info('IPC', 'loadInitialState called');

  const subscriptions = deps.subscriptionRepository.list();
  const manualLinks = deps.subscriptionRepository.getManualLinks();
  const pendingTunReconnect = !!deps.configService.peekPendingTunReconnect();
  const relaunchedElevated = deps.relaunchedElevated ?? isElevatedRelaunch();

  logger.info('IPC', 'loadInitialState', {
    subscriptionCount: subscriptions.length,
    enabledCount: subscriptions.filter((s) => s.enabled).length,
    hasManualLinks: !!manualLinks,
    hasPendingTunReconnect: pendingTunReconnect,
    relaunchedElevated,
  });

  if (relaunchedElevated && !pendingTunReconnect) {
    // The predecessor persisted the reconnect into *its* userData. When UAC
    // was answered with a different administrator account this process runs
    // under another profile and sees a foreign (usually empty) store.
    logger.warn(
      'IPC',
      'Started as an elevated relaunch but no pending TUN reconnect was found; ' +
        'the elevated instance may run under a different user profile',
    );
  }

  actions.notifySnapshot('bootstrap');

  // The TUN session persisted before the UAC relaunch resumes from the stored
  // catalog right away. It must not wait for the network refresh below: that
  // fetch can take tens of seconds, and a catalog rotation during the connect
  // is handled by `reconcileActiveServer`. Without a pending entry this is a
  // cheap no-op that also drops a stale record. Not awaited: a TUN bring-up
  // can take a while and must not hold the window's load-complete path.
  void actions.attemptPendingTunReconnect().catch((error) => {
    logger.error('IPC', 'Pending TUN reconnect failed', error);
  });

  const hasInput = subscriptions.some((s) => s.enabled) || !!manualLinks.trim();
  if (!hasInput) {
    logger.info('IPC', 'No enabled subscriptions or manual links saved');
    deps.stopAutoRefreshTimer();
    return;
  }

  const handleRefreshResult = (result: RefreshResult): void => {
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

  const runRefresh = async (): Promise<void> => {
    const timer = new PerfTimer('IPC', 'initial subscription refresh');
    try {
      const result = await actions.queueRefreshAllSubscriptions(manualLinks);
      timer.end({ configCount: result.configCount });
      handleRefreshResult(result);
    } catch (error) {
      timer.end({ failed: true });
      actions.reportSubscriptionRefreshIssue(
        error instanceof Error ? error.message : String(error),
      );
    }
  };

  // Let the first paint land before the network round trip; a pending TUN
  // resume is already in flight and does not depend on this.
  setTimeout(() => {
    void runRefresh();
  }, SUBSCRIPTION_REFRESH_DEFER_MS);
  actions.restartAutoRefreshTimer();
}
