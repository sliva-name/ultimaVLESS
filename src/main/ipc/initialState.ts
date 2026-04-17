import { BrowserWindow } from 'electron';
import { IPC_EVENT_CHANNELS } from '@/shared/ipc';
import { toSafeServerList } from '@/shared/serverView';
import { logger } from '@/main/services/LoggerService';
import { IpcDependencies } from './dependencies';

interface InitialStateDeps {
  configService: IpcDependencies['configService'];
  connectionMonitorService: IpcDependencies['connectionMonitorService'];
  xrayService: IpcDependencies['xrayService'];
  createRuntimeDependencies: () => IpcDependencies;
  stopAutoRefreshTimer: () => void;
}

interface InitialStateActions {
  sendToRenderer: (channel: (typeof IPC_EVENT_CHANNELS)[keyof typeof IPC_EVENT_CHANNELS], ...args: unknown[]) => void;
  queueRefreshAllSubscriptions: (manualLinks: string) => Promise<{ configCount: number; reason?: string; partialErrors?: string[] }>;
  reportSubscriptionRefreshIssue: (reason: string) => void;
  restartAutoRefreshTimer: () => void;
  attemptPendingTunReconnect: (
    serverId: string,
    deps: IpcDependencies,
    options?: { emitErrorOnFailure: boolean }
  ) => Promise<boolean>;
}

export async function loadInitialState(
  _window: BrowserWindow,
  actions: InitialStateActions,
  deps: InitialStateDeps
): Promise<void> {
  logger.info('IPC', 'loadInitialState called');
  const runtimeDeps = deps.createRuntimeDependencies();

  const subscriptions = deps.configService.getSubscriptions();
  const manualLinks = deps.configService.getManualLinksInput();
  const pendingTunReconnectServerId = deps.configService.consumePendingTunReconnect();

  logger.info('IPC', 'loadInitialState', {
    subscriptionCount: subscriptions.length,
    enabledCount: subscriptions.filter((s) => s.enabled).length,
    hasManualLinks: !!manualLinks,
    hasPendingTunReconnect: !!pendingTunReconnectServerId,
  });

  const savedServers = deps.configService.getServers();
  actions.sendToRenderer(IPC_EVENT_CHANNELS.updateServers, toSafeServerList(savedServers));
  actions.sendToRenderer(IPC_EVENT_CHANNELS.updateSubscriptions, subscriptions);

  let pendingTunReconnectJob: Promise<boolean> | null = null;
  if (pendingTunReconnectServerId) {
    pendingTunReconnectJob = actions.attemptPendingTunReconnect(pendingTunReconnectServerId, runtimeDeps, {
      emitErrorOnFailure: !(subscriptions.some((s) => s.enabled) || manualLinks),
    });
  }

  const hasInput = subscriptions.some((s) => s.enabled) || !!manualLinks.trim();
  if (hasInput) {
    const refreshJob = actions.queueRefreshAllSubscriptions(manualLinks);
    void refreshJob
      .then((result) => {
        if (result.configCount === 0) {
          actions.reportSubscriptionRefreshIssue(result.reason || 'No valid configuration links were found');
        } else if (result.partialErrors && result.partialErrors.length > 0) {
          logger.warn('IPC', 'Some subscriptions failed on initial load', {
            errors: result.partialErrors,
          });
        }
      })
      .catch((error) => {
        const reason = error instanceof Error ? error.message : String(error);
        actions.reportSubscriptionRefreshIssue(reason);
      });

    if (pendingTunReconnectServerId) {
      void refreshJob.then(async () => {
        if (pendingTunReconnectJob) {
          try {
            await pendingTunReconnectJob;
          } catch {
            // attemptPendingTunReconnect already logs and handles errors
          }
        }
        const monitorStatus = deps.connectionMonitorService.getStatus();
        const alreadyConnected =
          deps.xrayService.isRunning() &&
          monitorStatus.isConnected &&
          monitorStatus.currentServer?.uuid === pendingTunReconnectServerId;
        if (alreadyConnected) {
          logger.info('IPC', 'Skipping pending TUN reconnect retry: already connected', {
            serverId: pendingTunReconnectServerId.substring(0, 8),
          });
          return;
        }
        return actions.attemptPendingTunReconnect(pendingTunReconnectServerId, runtimeDeps, { emitErrorOnFailure: true });
      }).catch((error) => {
        logger.error('IPC', 'Pending TUN reconnect retry after refresh failed', error);
      });
    }
    actions.restartAutoRefreshTimer();
  } else {
    logger.info('IPC', 'No enabled subscriptions or manual links saved');
    deps.stopAutoRefreshTimer();
  }
}
