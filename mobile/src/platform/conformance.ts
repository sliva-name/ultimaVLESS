/**
 * Type-level check that each Android module offers what the desktop code
 * calls on the module it replaces. The bundler swaps them by file, so the
 * compiler never sees the pairing otherwise. Nothing here runs or ships.
 */
import type { XrayService as DesktopXrayService } from '@desktop/main/services/XrayService';
import type { SystemProxyService as DesktopSystemProxyService } from '@desktop/main/services/SystemProxyService';
import type { TunRouteService as DesktopTunRouteService } from '@desktop/main/services/TunRouteService';
import type { TrafficStatsService as DesktopTrafficStatsService } from '@desktop/main/services/TrafficStatsService';
import type { ConflictingAppsService as DesktopConflictingAppsService } from '@desktop/main/services/ConflictingAppsService';
import type { AppUpdaterService as DesktopAppUpdaterService } from '@desktop/main/services/AppUpdaterService';
import type { LogExportService as DesktopLogExportService } from '@desktop/main/services/LogExportService';
import type { LoggerService as DesktopLoggerService } from '@desktop/main/services/LoggerService';
import type { TrayService as DesktopTrayService } from '@desktop/main/services/TrayService';
import type { XrayLogCursor as DesktopXrayLogCursor } from '@desktop/main/services/connectionMonitor/xrayLogCursor';
import type * as DesktopPrivilege from '@desktop/main/services/PrivilegeService';
import type * as DesktopRunningApps from '@desktop/main/services/runningApps';
import type { RealDelayService as DesktopRealDelayService } from '@desktop/main/services/RealDelayService';
import type { XrayService } from './XrayService';
import type { SystemProxyService } from './SystemProxyService';
import type { TunRouteService } from './TunRouteService';
import type { TrafficStatsService } from './TrafficStatsService';
import type { ConflictingAppsService } from './ConflictingAppsService';
import type { AppUpdaterService } from './AppUpdaterService';
import type { LogExportService } from './LogExportService';
import type { LoggerService } from './LoggerService';
import type { TrayService } from './TrayService';
import type { XrayLogCursor } from './xrayLogCursor';
import type * as Privilege from './PrivilegeService';
import type * as RunningApps from './runningApps';
import type { RealDelayService } from './RealDelayService';

/** `Actual` must accept every call the desktop code makes on `Expected[K]`. */
type Covers<Expected, Actual extends { [K in keyof Expected]: unknown }> = {
  [K in keyof Expected]: Expected[K] extends (...args: infer A) => infer R
    ? Actual[K] extends (...args: A) => infer AR
      ? Awaited<AR> extends Awaited<R>
        ? true
        : ['return type differs', K]
      : ['parameters differ', K]
    : true;
};

type AllTrue<T> = T[keyof T] extends true ? true : T;

type Methods<T, K extends keyof T> = Pick<T, K>;

export type Conformance = [
  AllTrue<
    Covers<
      Methods<
        DesktopXrayService,
        'start' | 'stop' | 'isRunning' | 'getActivePorts' | 'getHealthStatus'
      >,
      XrayService
    >
  >,
  AllTrue<
    Covers<
      Methods<
        DesktopSystemProxyService,
        'enable' | 'disable' | 'recoverOrphanedState'
      >,
      SystemProxyService
    >
  >,
  AllTrue<
    Covers<
      Methods<
        DesktopTunRouteService,
        | 'isSupported'
        | 'getUnsupportedReason'
        | 'getRouteMode'
        | 'getDegradedReason'
        | 'listNetworkAdapters'
        | 'recoverOrphanedRoutes'
      >,
      TunRouteService
    >
  >,
  AllTrue<
    Covers<
      Methods<DesktopTrafficStatsService, 'start' | 'stop' | 'getLastSnapshot'>,
      TrafficStatsService
    >
  >,
  AllTrue<
    Covers<
      Methods<
        DesktopConflictingAppsService,
        'getTunCheck' | 'startTunCheck' | 'scan' | 'close'
      >,
      ConflictingAppsService
    >
  >,
  AllTrue<
    Covers<
      Methods<
        DesktopAppUpdaterService,
        | 'start'
        | 'getStatus'
        | 'checkForUpdates'
        | 'hasDownloadedUpdate'
        | 'installDownloadedUpdate'
        | 'quitAndInstall'
        | 'setConnectionBusyGetter'
        | 'dispose'
      >,
      AppUpdaterService
    >
  >,
  AllTrue<
    Covers<
      Methods<DesktopLogExportService, 'getExportableLogs' | 'openLogFolder'>,
      LogExportService
    >
  >,
  AllTrue<
    Covers<
      Methods<
        DesktopLoggerService,
        | 'info'
        | 'warn'
        | 'error'
        | 'debug'
        | 'log'
        | 'flush'
        | 'getLogPath'
        | 'beginSession'
      >,
      LoggerService
    >
  >,
  AllTrue<
    Covers<
      Methods<
        DesktopTrayService,
        | 'setConnecting'
        | 'setConnected'
        | 'setDisconnected'
        | 'reportError'
        | 'reportSwitching'
      >,
      TrayService
    >
  >,
  AllTrue<
    Covers<
      Methods<DesktopXrayLogCursor, 'resetToFileEnd' | 'readNewLines'>,
      XrayLogCursor
    >
  >,
  AllTrue<
    Covers<
      Pick<
        typeof DesktopPrivilege,
        | 'hasTunPrivileges'
        | 'requestTunPrivilegesRelaunch'
        | 'isElevatedOnWindows'
        | 'relaunchAsAdminOnWindows'
      >,
      typeof Privilege
    >
  >,
  AllTrue<
    Covers<
      Pick<typeof DesktopRunningApps, 'listRunningApps'>,
      typeof RunningApps
    >
  >,
  AllTrue<
    Covers<
      Methods<DesktopRealDelayService, 'pingServer' | 'pingServers'>,
      RealDelayService
    >
  >,
];

/** Fails to compile when any entry above is not `true`. */
export const conformance: Conformance extends true[] ? true : never = true;
