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
import { pingService } from '@/main/services/PingService';
import { appRecoveryService } from '@/main/services/AppRecoveryService';
import { appUpdaterService } from '@/main/services/AppUpdaterService';
import { logExportService } from '@/main/services/LogExportService';
import { mainLocaleService } from '@/main/services/MainLocaleService';
import { trafficStatsService } from '@/main/services/TrafficStatsService';

export interface IpcDependencies {
  app: {
    releaseSingleInstanceLock: () => void;
    quit: () => void;
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
  pingService: typeof pingService;
  appRecoveryService: typeof appRecoveryService;
  appUpdaterService: typeof appUpdaterService;
  logExportService: typeof logExportService;
  mainLocaleService: typeof mainLocaleService;
  trafficStatsService: typeof trafficStatsService;
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
    appRecoveryService,
    appUpdaterService,
    logExportService,
    mainLocaleService,
    trafficStatsService,
  };
}
