import { BrowserWindow } from 'electron';
import { VlessConfig } from '../../shared/types';
import { IpcEventChannel, IPC_EVENT_CHANNELS } from '../../shared/ipc';
import { toSafeServerList } from '../../shared/serverView';
import { logger } from '../services/LoggerService';
import { preserveActiveServerIfNeeded } from './refreshUtils';
import { redactUrl } from './validators';

type RefreshSubscriptionResult = { configCount: number; reason?: string; partialErrors?: string[] };

interface SubscriptionRefreshManagerDeps {
  getWindow: () => BrowserWindow | null;
  configService: {
    getSubscriptions: () => Array<{ id: string; name: string; url: string; enabled: boolean }>;
    getManualLinksInput: () => string;
    getServers: () => VlessConfig[];
    setServers: (servers: VlessConfig[]) => void;
    getSelectedServerId: () => string | null;
    setSelectedServerId: (serverId: string | null) => void;
  };
  subscriptionService: {
    fetchAndParseDetailed: (url: string) => Promise<{ configs: VlessConfig[] }>;
    parseDirectLinksFromText: (text: string) => VlessConfig[];
  };
  connectionMonitorService: {
    getStatus: () => {
      isConnected: boolean;
      currentServer: VlessConfig | null;
    };
    syncCurrentServer: (servers: VlessConfig[]) => VlessConfig | null;
  };
  xrayService: {
    isRunning: () => boolean;
  };
}

const AUTO_REFRESH_INTERVAL_MS = 10 * 60 * 1000;

function getDedupKey(config: VlessConfig): string {
  return [
    config.uuid || '',
    config.address || '',
    String(config.port || 0),
    config.type || '',
    config.security || '',
    config.sni || '',
    config.fp || '',
    config.pbk || '',
    config.sid || '',
    config.spx || '',
    config.path || '',
    config.host || '',
    config.serviceName || '',
    config.flow || '',
    config.encryption || '',
  ].join('|');
}

export function createSubscriptionRefreshManager(deps: SubscriptionRefreshManagerDeps) {
  let refreshQueue: Promise<RefreshSubscriptionResult> = Promise.resolve({ configCount: 0 });
  let autoRefreshTimer: NodeJS.Timeout | null = null;

  const sendToRenderer = (channel: IpcEventChannel, ...args: unknown[]) => {
    const win = deps.getWindow();
    if (win) {
      win.webContents.send(channel, ...args);
    }
  };

  const reportSubscriptionRefreshIssue = (reason: string): void => {
    const message = `Subscription update failed: ${reason}`;
    logger.warn('IPC', message);
    sendToRenderer(IPC_EVENT_CHANNELS.connectionError, message);
  };

  const refreshAllSubscriptions = async (manualLinks: string): Promise<RefreshSubscriptionResult> => {
    const subscriptions = deps.configService.getSubscriptions();
    const enabled = subscriptions.filter((s) => s.enabled);

    logger.info('IPC', 'refreshAllSubscriptions start', {
      enabledCount: enabled.length,
      hasManualLinks: !!manualLinks?.trim(),
    });

    const configs: VlessConfig[] = [];
    const partialErrors: string[] = [];
    const failedSubscriptionIds = new Set<string>();

    for (const sub of enabled) {
      try {
        const result = await deps.subscriptionService.fetchAndParseDetailed(sub.url.trim());
        configs.push(
          ...result.configs.map((cfg) => ({
            ...cfg,
            source: 'subscription' as const,
            subscriptionId: sub.id,
          }))
        );
        logger.info('IPC', `Fetched subscription "${sub.name}"`, {
          count: result.configs.length,
          redactedUrl: redactUrl(sub.url),
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        partialErrors.push(`${sub.name}: ${msg}`);
        failedSubscriptionIds.add(sub.id);
        logger.error('IPC', `Failed to fetch subscription "${sub.name}"`, error);
      }
    }

    const effectiveManualLinksText = manualLinks.trim();
    if (effectiveManualLinksText) {
      const manualConfigs = deps.subscriptionService.parseDirectLinksFromText(effectiveManualLinksText);
      configs.push(...manualConfigs.map((cfg) => ({ ...cfg, source: 'manual' as const })));
    }

    const uniqueConfigs = Array.from(new Map(configs.map((cfg) => [getDedupKey(cfg), cfg])).values());
    logger.info('IPC', 'refreshAllSubscriptions dedup', { total: uniqueConfigs.length });

    const existingServers = deps.configService.getServers();

    let mergedConfigs = uniqueConfigs;
    if (failedSubscriptionIds.size > 0) {
      const freshKeys = new Set(uniqueConfigs.map(getDedupKey));
      const preservedFromFailed = existingServers.filter(
        (s) => s.subscriptionId && failedSubscriptionIds.has(s.subscriptionId) && !freshKeys.has(getDedupKey(s))
      );
      if (preservedFromFailed.length > 0) {
        logger.warn('IPC', 'Preserving servers from failed subscriptions to prevent data loss', {
          preserved: preservedFromFailed.length,
          failedCount: failedSubscriptionIds.size,
        });
        mergedConfigs = [...uniqueConfigs, ...preservedFromFailed];
      }
    }

    const pingDataMap = new Map<string, { ping: number | null; pingTime: number | undefined }>();
    existingServers.forEach((server) => {
      if (server.ping !== undefined || server.pingTime !== undefined) {
        pingDataMap.set(server.uuid, {
          ping: server.ping ?? null,
          pingTime: server.pingTime,
        });
      }
    });

    const configsWithPing = mergedConfigs.map((config) => {
      const pingData = pingDataMap.get(config.uuid);
      if (pingData) {
        return { ...config, ping: pingData.ping, pingTime: pingData.pingTime };
      }
      return { ...config, ping: null };
    });

    const monitorStatus = deps.connectionMonitorService.getStatus();
    const effectiveConfigs = preserveActiveServerIfNeeded(
      configsWithPing,
      existingServers,
      monitorStatus,
      deps.xrayService.isRunning()
    );
    if (effectiveConfigs.length !== configsWithPing.length && monitorStatus.currentServer) {
      logger.warn('IPC', 'Preserving active server during background refresh', {
        serverId: monitorStatus.currentServer.uuid.substring(0, 8),
        serverName: monitorStatus.currentServer.name,
      });
    }

    const hasInput = enabled.length > 0 || !!manualLinks.trim();
    if (effectiveConfigs.length === 0 && hasInput) {
      return {
        configCount: 0,
        partialErrors,
        reason: partialErrors.length > 0
          ? partialErrors.join('; ')
          : 'No valid configuration links were found',
      };
    }

    deps.configService.setServers(effectiveConfigs);
    const syncedCurrentServer = deps.connectionMonitorService.syncCurrentServer(effectiveConfigs);
    if (syncedCurrentServer) {
      deps.configService.setSelectedServerId(syncedCurrentServer.uuid);
    } else {
      const currentSelectedId = deps.configService.getSelectedServerId();
      if (currentSelectedId && !effectiveConfigs.some((s) => s.uuid === currentSelectedId)) {
        const oldServer = existingServers.find((s) => s.uuid === currentSelectedId);
        if (oldServer) {
          const fuzzy = effectiveConfigs.find((s) => s.address === oldServer.address && s.port === oldServer.port);
          if (fuzzy) {
            deps.configService.setSelectedServerId(fuzzy.uuid);
          }
        }
      }
    }
    sendToRenderer(IPC_EVENT_CHANNELS.updateServers, toSafeServerList(effectiveConfigs));

    return {
      configCount: effectiveConfigs.length,
      partialErrors,
    };
  };

  const queueRefreshAllSubscriptions = (manualLinks: string): Promise<RefreshSubscriptionResult> => {
    const job = refreshQueue.then(() => refreshAllSubscriptions(manualLinks));
    refreshQueue = job.catch(() => ({ configCount: 0 }));
    return job;
  };

  const stopAutoRefreshTimer = (): void => {
    if (autoRefreshTimer) {
      clearInterval(autoRefreshTimer);
      autoRefreshTimer = null;
      logger.info('IPC', 'Auto-refresh timer stopped');
    }
  };

  const restartAutoRefreshTimer = (): void => {
    const subscriptions = deps.configService.getSubscriptions();
    const manualLinks = deps.configService.getManualLinksInput();
    const hasInput = subscriptions.some((s) => s.enabled) || !!manualLinks.trim();

    stopAutoRefreshTimer();
    if (!hasInput) {
      logger.info('IPC', 'Auto-refresh timer not started: no subscription input');
      return;
    }

    autoRefreshTimer = setInterval(() => {
      const latestManualLinks = deps.configService.getManualLinksInput();
      const latestSubs = deps.configService.getSubscriptions();
      const hasLatestInput = latestSubs.some((s) => s.enabled) || !!latestManualLinks.trim();

      if (!hasLatestInput) {
        stopAutoRefreshTimer();
        return;
      }

      void queueRefreshAllSubscriptions(latestManualLinks)
        .then((result) => {
          if (result.configCount === 0) {
            reportSubscriptionRefreshIssue(result.reason || 'No valid configuration links were found');
          } else if (result.partialErrors && result.partialErrors.length > 0) {
            logger.warn('IPC', 'Some subscriptions failed during auto-refresh', {
              errors: result.partialErrors,
            });
          }
        })
        .catch((error) => {
          const reason = error instanceof Error ? error.message : String(error);
          reportSubscriptionRefreshIssue(reason);
        });
    }, AUTO_REFRESH_INTERVAL_MS);

    logger.info('IPC', 'Auto-refresh timer started', {
      intervalMs: AUTO_REFRESH_INTERVAL_MS,
      subscriptionCount: subscriptions.filter((s) => s.enabled).length,
      hasManualLinks: !!manualLinks.trim(),
    });
  };

  return {
    queueRefreshAllSubscriptions,
    stopAutoRefreshTimer,
    restartAutoRefreshTimer,
    reportSubscriptionRefreshIssue,
  };
}
