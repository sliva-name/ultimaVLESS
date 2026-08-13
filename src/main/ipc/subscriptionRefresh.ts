import { BrowserWindow } from 'electron';
import { VlessConfig } from '@/shared/types';
import {
  getServerDedupKey,
  getServerEndpointKey,
} from '@/shared/serverIdentity';
import { logger } from '@/main/services/LoggerService';
import { PerfTimer } from '@/shared/perfMetrics';
import type { ServerRepository } from '@/main/domain/server/ServerRepository';
import type { SubscriptionRepository } from '@/main/domain/subscription/SubscriptionRepository';
import { preserveActiveServerIfNeeded } from './refreshUtils';
import { redactUrl } from './validators';

type RefreshSubscriptionResult = {
  configCount: number;
  reason?: string;
  partialErrors?: string[];
};

interface SubscriptionRefreshManagerDeps {
  getWindow: () => BrowserWindow | null;
  subscriptionRepository: Pick<
    SubscriptionRepository,
    'list' | 'getManualLinks'
  >;
  serverRepository: Pick<ServerRepository, 'list' | 'saveAll'>;
  configService: {
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
  notifyStateChanged?: () => void;
}

const AUTO_REFRESH_INTERVAL_MS = 10 * 60 * 1000;
const MAX_CONCURRENT_SUBSCRIPTION_FETCHES = 4;

const activeAutoRefreshStoppers = new Set<() => void>();

/** Stops the auto-refresh timer of every created manager (app shutdown). */
export function stopAllSubscriptionAutoRefreshTimers(): void {
  for (const stop of activeAutoRefreshStoppers) {
    stop();
  }
}

export function createSubscriptionRefreshManager(
  deps: SubscriptionRefreshManagerDeps,
) {
  let refreshQueue: Promise<RefreshSubscriptionResult> = Promise.resolve({
    configCount: 0,
  });
  let autoRefreshTimer: NodeJS.Timeout | null = null;

  const notifyStateChanged = () => {
    deps.notifyStateChanged?.();
  };

  const reportSubscriptionRefreshIssue = (reason: string): void => {
    const message = `Subscription update failed: ${reason}`;
    logger.warn('IPC', message);
    notifyStateChanged();
  };

  const refreshAllSubscriptions = async (
    manualLinks: string,
  ): Promise<RefreshSubscriptionResult> => {
    const refreshTimer = new PerfTimer('IPC', 'refreshAllSubscriptions');
    const subscriptions = deps.subscriptionRepository.list();
    const enabled = subscriptions.filter((s) => s.enabled);

    logger.info('IPC', 'refreshAllSubscriptions start', {
      enabledCount: enabled.length,
      hasManualLinks: !!manualLinks?.trim(),
    });

    const configs: VlessConfig[] = [];
    const partialErrorsByIndex: Array<string | null> = enabled.map(() => null);
    const failedSubscriptionIds = new Set<string>();
    const subscriptionConfigsByIndex: VlessConfig[][] = enabled.map(() => []);

    let nextSubscriptionIndex = 0;
    const fetchNextSubscription = async (): Promise<void> => {
      while (nextSubscriptionIndex < enabled.length) {
        const index = nextSubscriptionIndex;
        nextSubscriptionIndex += 1;
        const sub = enabled[index];
        if (!sub) {
          return;
        }
        try {
          const result = await deps.subscriptionService.fetchAndParseDetailed(
            sub.url.trim(),
          );
          subscriptionConfigsByIndex[index] = result.configs.map((cfg) => ({
            ...cfg,
            source: 'subscription' as const,
            subscriptionId: sub.id,
          }));
          logger.info('IPC', `Fetched subscription "${sub.name}"`, {
            count: result.configs.length,
            redactedUrl: redactUrl(sub.url),
          });
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          partialErrorsByIndex[index] = `${sub.name}: ${msg}`;
          failedSubscriptionIds.add(sub.id);
          logger.error(
            'IPC',
            `Failed to fetch subscription "${sub.name}"`,
            error,
          );
        }
      }
    };

    const workerCount = Math.min(
      MAX_CONCURRENT_SUBSCRIPTION_FETCHES,
      enabled.length,
    );
    await Promise.all(
      Array.from({ length: workerCount }, () => fetchNextSubscription()),
    );
    configs.push(...subscriptionConfigsByIndex.flat());
    const partialErrors = partialErrorsByIndex.filter(
      (msg): msg is string => msg !== null,
    );

    const effectiveManualLinksText = manualLinks.trim();
    if (effectiveManualLinksText) {
      const manualConfigs = deps.subscriptionService.parseDirectLinksFromText(
        effectiveManualLinksText,
      );
      configs.push(
        ...manualConfigs.map((cfg) => ({ ...cfg, source: 'manual' as const })),
      );
    }

    const refreshedConfigs = configs;
    logger.info('IPC', 'refreshAllSubscriptions parsed configs', {
      total: refreshedConfigs.length,
    });

    const existingServers = deps.serverRepository.list();

    let mergedConfigs = refreshedConfigs;
    if (failedSubscriptionIds.size > 0) {
      const freshKeys = new Set(refreshedConfigs.map(getServerDedupKey));
      const preservedFromFailed = existingServers.filter(
        (s) =>
          s.subscriptionId &&
          failedSubscriptionIds.has(s.subscriptionId) &&
          !freshKeys.has(getServerDedupKey(s)),
      );
      if (preservedFromFailed.length > 0) {
        logger.warn(
          'IPC',
          'Preserving servers from failed subscriptions to prevent data loss',
          {
            preserved: preservedFromFailed.length,
            failedCount: failedSubscriptionIds.size,
          },
        );
        mergedConfigs = [...refreshedConfigs, ...preservedFromFailed];
      }
    }

    // Preserve previously measured ping data across refreshes. The primary
    // index is by `uuid`, but some subscription providers rotate VLESS UUIDs /
    // Trojan passwords / Reality `sid` between fetches — that produces a new
    // deterministic stable-id hash for the *same* endpoint and would wipe the
    // ping value on every refresh. Fall back to a fuzzy index keyed by
    // `protocol|address:port` (mirrors `syncCurrentServer`'s tolerance) so the
    // UI keeps a usable latency right after subscription refreshes — including
    // the one that fires automatically after the UAC auto-relaunch into TUN
    // mode.
    type StoredPing = { ping: number | null; pingTime: number | undefined };
    const pingByUuid = new Map<string, StoredPing>();
    const pingByEndpoint = new Map<string, StoredPing>();
    const pingBySourceName = new Map<string, StoredPing>();
    const sourceNameKey = (cfg: VlessConfig): string | null => {
      if (!cfg.name.trim()) return null;
      const sourceKey =
        cfg.source === 'subscription' && cfg.subscriptionId
          ? `subscription:${cfg.subscriptionId}`
          : cfg.source === 'manual'
            ? 'manual'
            : null;
      if (!sourceKey) return null;
      return `${sourceKey}|${cfg.name.trim().toLocaleLowerCase()}`;
    };
    const setFreshestPing = (
      index: Map<string, StoredPing>,
      key: string | null,
      stored: StoredPing,
    ): void => {
      if (!key) return;
      const previous = index.get(key);
      if (!previous || (stored.pingTime ?? 0) > (previous.pingTime ?? 0)) {
        index.set(key, stored);
      }
    };
    const applyStoredPing = (
      config: VlessConfig,
      stored: StoredPing,
    ): VlessConfig => ({
      ...config,
      ping: stored.ping,
      pingTime: stored.pingTime,
      pingStale: stored.ping != null,
    });

    existingServers.forEach((server) => {
      if (server.ping === undefined && server.pingTime === undefined) return;
      const stored: StoredPing = {
        ping: server.ping ?? null,
        pingTime: server.pingTime,
      };
      pingByUuid.set(server.uuid, stored);
      // Prefer the freshest sample if multiple stored entries share an endpoint
      // (e.g. a rotated server still co-existing with its previous incarnation
      // from `preserveActiveServerIfNeeded`).
      setFreshestPing(pingByEndpoint, getServerEndpointKey(server), stored);
      // Some providers rotate both internal ids and hostnames during the startup
      // refresh after the UAC relaunch. While connected we cannot re-ping, so
      // keep the last known value for the same named entry in the same source.
      setFreshestPing(pingBySourceName, sourceNameKey(server), stored);
    });

    const configsWithPing = mergedConfigs.map((config) => {
      const direct = pingByUuid.get(config.uuid);
      if (direct) {
        return applyStoredPing(config, direct);
      }
      const fuzzy = pingByEndpoint.get(getServerEndpointKey(config));
      if (fuzzy) {
        return applyStoredPing(config, fuzzy);
      }
      const configSourceNameKey = sourceNameKey(config);
      const bySourceName = configSourceNameKey
        ? pingBySourceName.get(configSourceNameKey)
        : undefined;
      if (bySourceName) {
        return applyStoredPing(config, bySourceName);
      }
      return { ...config, ping: null, pingStale: false };
    });

    // The enabled list was captured when the refresh started; the user may
    // have disabled or deleted a subscription while fetches were in flight.
    // Re-read the current subscriptions and drop configs that belong to
    // subscriptions that are no longer enabled/present.
    const enabledIdsNow = new Set(
      deps.subscriptionRepository
        .list()
        .filter((s) => s.enabled)
        .map((s) => s.id),
    );
    const currentConfigsWithPing = configsWithPing.filter(
      (cfg) =>
        cfg.source !== 'subscription' ||
        !cfg.subscriptionId ||
        enabledIdsNow.has(cfg.subscriptionId),
    );

    const monitorStatus = deps.connectionMonitorService.getStatus();
    const selectedIdBeforeRefresh = deps.configService.getSelectedServerId();
    const effectiveConfigs = preserveActiveServerIfNeeded(
      currentConfigsWithPing,
      existingServers,
      monitorStatus,
      deps.xrayService.isRunning(),
      selectedIdBeforeRefresh,
    );
    if (
      effectiveConfigs.length !== currentConfigsWithPing.length &&
      monitorStatus.currentServer
    ) {
      logger.warn('IPC', 'Preserving active server during background refresh', {
        serverId: monitorStatus.currentServer.uuid.substring(0, 8),
        serverName: monitorStatus.currentServer.name,
      });
    }

    const hasInput = enabled.length > 0 || !!manualLinks.trim();
    if (effectiveConfigs.length === 0 && hasInput) {
      refreshTimer.end({ configCount: 0, enabledCount: enabled.length });
      return {
        configCount: 0,
        partialErrors,
        reason:
          partialErrors.length > 0
            ? partialErrors.join('; ')
            : 'No valid configuration links were found',
      };
    }

    deps.serverRepository.saveAll(effectiveConfigs);
    const syncedCurrentServer =
      deps.connectionMonitorService.syncCurrentServer(effectiveConfigs);
    if (syncedCurrentServer) {
      deps.configService.setSelectedServerId(syncedCurrentServer.uuid);
    } else if (
      selectedIdBeforeRefresh &&
      !effectiveConfigs.some((s) => s.uuid === selectedIdBeforeRefresh)
    ) {
      const oldServer = existingServers.find(
        (s) => s.uuid === selectedIdBeforeRefresh,
      );
      if (oldServer) {
        const fuzzy =
          effectiveConfigs.find(
            (s) =>
              s.address === oldServer.address &&
              s.port === oldServer.port &&
              s.name === oldServer.name,
          ) ??
          effectiveConfigs.find(
            (s) => s.address === oldServer.address && s.port === oldServer.port,
          );
        if (fuzzy) {
          deps.configService.setSelectedServerId(fuzzy.uuid);
        }
      }
    }
    notifyStateChanged();

    refreshTimer.end({
      configCount: effectiveConfigs.length,
      enabledCount: enabled.length,
    });

    return {
      configCount: effectiveConfigs.length,
      partialErrors,
    };
  };

  const queueRefreshAllSubscriptions = (
    manualLinks: string,
  ): Promise<RefreshSubscriptionResult> => {
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
    const subscriptions = deps.subscriptionRepository.list();
    const manualLinks = deps.subscriptionRepository.getManualLinks();
    const hasInput =
      subscriptions.some((s) => s.enabled) || !!manualLinks.trim();

    stopAutoRefreshTimer();
    if (!hasInput) {
      logger.info(
        'IPC',
        'Auto-refresh timer not started: no subscription input',
      );
      return;
    }

    autoRefreshTimer = setInterval(() => {
      const latestManualLinks = deps.subscriptionRepository.getManualLinks();
      const latestSubs = deps.subscriptionRepository.list();
      const hasLatestInput =
        latestSubs.some((s) => s.enabled) || !!latestManualLinks.trim();

      if (!hasLatestInput) {
        stopAutoRefreshTimer();
        return;
      }

      void queueRefreshAllSubscriptions(latestManualLinks)
        .then((result) => {
          if (result.configCount === 0) {
            reportSubscriptionRefreshIssue(
              result.reason || 'No valid configuration links were found',
            );
          } else if (result.partialErrors && result.partialErrors.length > 0) {
            logger.warn(
              'IPC',
              'Some subscriptions failed during auto-refresh',
              {
                errors: result.partialErrors,
              },
            );
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

  activeAutoRefreshStoppers.add(stopAutoRefreshTimer);

  return {
    queueRefreshAllSubscriptions,
    stopAutoRefreshTimer,
    restartAutoRefreshTimer,
    reportSubscriptionRefreshIssue,
  };
}
