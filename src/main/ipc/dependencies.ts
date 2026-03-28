import { app } from 'electron';
import { APP_CONSTANTS } from '../../shared/constants';
import { configService } from '../services/ConfigService';
import { connectionMonitorService } from '../services/ConnectionMonitorService';
import {
  isElevatedOnWindows,
  relaunchAsAdminOnWindows,
  hasTunPrivileges,
  requestTunPrivilegesRelaunch,
} from '../services/PrivilegeService';
import { connectionStackService } from '../services/ConnectionStackService';
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
  connectionStackService: typeof connectionStackService;
  connectionMonitorService: typeof connectionMonitorService;
  isElevatedOnWindows: typeof isElevatedOnWindows;
  relaunchAsAdminOnWindows: typeof relaunchAsAdminOnWindows;
  hasTunPrivileges: typeof hasTunPrivileges;
  requestTunPrivilegesRelaunch: typeof requestTunPrivilegesRelaunch;
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
    connectionStackService,
    connectionMonitorService,
    isElevatedOnWindows,
    relaunchAsAdminOnWindows,
    hasTunPrivileges,
    requestTunPrivilegesRelaunch,
    systemProxyService,
    tunRouteService,
    xrayService,
    pingService,
  };
}
