import { app, shell } from 'electron';
import { APP_CONSTANTS } from '@/shared/constants';
import { configService } from '@/main/services/ConfigService';
import type { ServerRepository } from '@/main/domain/server/ServerRepository';
import type { SubscriptionRepository } from '@/main/domain/subscription/SubscriptionRepository';
import {
  getServerRepository,
  getSubscriptionRepository,
} from '@/main/infrastructure/persistence';
import { connectionMonitorService } from '@/main/services/ConnectionMonitorService';
import {
  isElevatedOnWindows,
  relaunchAsAdminOnWindows,
  hasTunPrivileges,
  requestTunPrivilegesRelaunch,
} from '@/main/services/PrivilegeService';
import { connectionManager } from '@/main/domain/connection/ConnectionManager';
import { systemProxyService } from '@/main/services/SystemProxyService';
import { tunRouteService } from '@/main/services/TunRouteService';
import { xrayService } from '@/main/services/XrayService';
import { pingService as tcpPingService } from '@/main/services/PingService';
import { RealDelayService } from '@/main/services/RealDelayService';
import {
  createServerLatencyProbe,
  type ServerLatencyProbe,
} from '@/main/services/serverLatencyProbe';
import { appRecoveryService } from '@/main/services/AppRecoveryService';
import { conflictingAppsService } from '@/main/services/ConflictingAppsService';
import { appUpdaterService } from '@/main/services/AppUpdaterService';
import { logExportService } from '@/main/services/LogExportService';
import { mainLocaleService } from '@/main/services/MainLocaleService';
import { trafficStatsService } from '@/main/services/TrafficStatsService';
import {
  createPingRefreshRunner,
  isPingUnsafePhase,
  type PingRefreshRunner,
} from '@/main/runtime/pingRefresh';

export interface IpcDependencies {
  app: {
    getVersion: () => string;
  };
  shell: {
    openExternal: (url: string) => Promise<void>;
  };
  constants: {
    ports: {
      http: number;
      socks: number;
      api: number;
    };
  };
  configService: typeof configService;
  serverRepository: ServerRepository;
  subscriptionRepository: SubscriptionRepository;
  connectionManager: typeof connectionManager;
  connectionMonitorService: typeof connectionMonitorService;
  isElevatedOnWindows: typeof isElevatedOnWindows;
  relaunchAsAdminOnWindows: typeof relaunchAsAdminOnWindows;
  hasTunPrivileges: typeof hasTunPrivileges;
  requestTunPrivilegesRelaunch: typeof requestTunPrivilegesRelaunch;
  systemProxyService: typeof systemProxyService;
  tunRouteService: typeof tunRouteService;
  xrayService: typeof xrayService;
  /** Latency probe for the configured ping method (TCP or real delay). */
  pingService: ServerLatencyProbe;
  /** Ping-all owner: toolbar runs, unattended runs, in-progress state. */
  pingRefresh: PingRefreshRunner;
  appRecoveryService: typeof appRecoveryService;
  conflictingAppsService: typeof conflictingAppsService;
  appUpdaterService: typeof appUpdaterService;
  logExportService: typeof logExportService;
  mainLocaleService: typeof mainLocaleService;
  trafficStatsService: typeof trafficStatsService;
}

const pingService = createServerLatencyProbe({
  tcp: tcpPingService,
  real: new RealDelayService({
    getPerformanceSettings: () => configService.getPerformanceSettings(),
  }),
  getMethod: () => configService.getPerformanceSettings().pingMethod,
});

let pingRefreshSingleton: PingRefreshRunner | null = null;

/**
 * One runner per process: it owns the serial queue and the background retry,
 * so a window re-creation must not spawn a second, competing instance.
 */
export function getPingRefreshRunner(): PingRefreshRunner {
  pingRefreshSingleton ??= createPingRefreshRunner({
    store: getServerRepository(),
    pingService,
    isUnsafe: () =>
      isPingUnsafePhase(
        connectionManager.getPhase(),
        connectionManager.isBusy(),
      ),
  });
  return pingRefreshSingleton;
}

export function createIpcDependencies(): IpcDependencies {
  return {
    app,
    shell,
    constants: {
      ports: {
        http: APP_CONSTANTS.PORTS.HTTP,
        socks: APP_CONSTANTS.PORTS.SOCKS,
        api: APP_CONSTANTS.PORTS.API,
      },
    },
    configService,
    serverRepository: getServerRepository(),
    subscriptionRepository: getSubscriptionRepository(),
    connectionManager,
    connectionMonitorService,
    isElevatedOnWindows,
    relaunchAsAdminOnWindows,
    hasTunPrivileges,
    requestTunPrivilegesRelaunch,
    systemProxyService,
    tunRouteService,
    xrayService,
    pingService,
    pingRefresh: getPingRefreshRunner(),
    appRecoveryService,
    conflictingAppsService,
    appUpdaterService,
    logExportService,
    mainLocaleService,
    trafficStatsService,
  };
}
