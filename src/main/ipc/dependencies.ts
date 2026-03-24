import { app } from 'electron';
import { APP_CONSTANTS } from '../../shared/constants';
import { configService } from '../services/ConfigService';
import { connectionMonitorService } from '../services/ConnectionMonitorService';
import { isElevatedOnWindows, relaunchAsAdminOnWindows } from '../services/PrivilegeService';
import { systemProxyService } from '../services/SystemProxyService';
import { tunRouteService } from '../services/TunRouteService';
import { xrayService } from '../services/XrayService';
import { pingService } from '../services/PingService';

export interface IpcDependencies {
  app: {
    releaseSingleInstanceLock: () => void;
    quit: () => void;
  };
  constants: {
    ports: {
      http: number;
      socks: number;
    };
  };
  configService: typeof configService;
  connectionMonitorService: typeof connectionMonitorService;
  isElevatedOnWindows: typeof isElevatedOnWindows;
  relaunchAsAdminOnWindows: typeof relaunchAsAdminOnWindows;
  systemProxyService: typeof systemProxyService;
  tunRouteService: typeof tunRouteService;
  xrayService: typeof xrayService;
  pingService: typeof pingService;
}

export function createIpcDependencies(): IpcDependencies {
  return {
    app,
    constants: {
      ports: {
        http: APP_CONSTANTS.PORTS.HTTP,
        socks: APP_CONSTANTS.PORTS.SOCKS,
      },
    },
    configService,
    connectionMonitorService,
    isElevatedOnWindows,
    relaunchAsAdminOnWindows,
    systemProxyService,
    tunRouteService,
    xrayService,
    pingService,
  };
}
