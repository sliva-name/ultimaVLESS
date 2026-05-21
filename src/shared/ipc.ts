import {
  ConnectionMode,
  PerformanceSettings,
  Subscription,
  VlessConfig,
} from './types';
import type { SafeVlessConfig } from './serverView';

export interface ConnectResult {
  ok: boolean;
  error?: string;
  relaunched?: boolean;
}

export interface DisconnectResult {
  ok: boolean;
}

export interface AddSubscriptionPayload {
  name: string;
  url: string;
}

export interface UpdateSubscriptionPayload {
  id: string;
  patch: {
    name?: string;
    url?: string;
    enabled?: boolean;
  };
}

export interface AddSubscriptionResult {
  ok: boolean;
  configCount: number;
  error?: string;
}

export interface SaveManualLinksResult {
  ok: boolean;
  configCount: number;
  error?: string;
}

export interface RefreshSubscriptionsResult {
  ok: boolean;
  configCount: number;
  error?: string;
}

export interface PingResult {
  uuid: string;
  latency: number | null;
}

export interface ServerPingPatch {
  uuid: string;
  ping: number | null;
  pingTime: number;
  pingStale?: boolean;
}

export interface ConnectionMonitorEvent {
  type: 'connected' | 'disconnected' | 'error' | 'blocked' | 'switching';
  server: SafeVlessConfig | null;
  error?: string;
  message?: string;
}

export type XrayHealthState =
  | 'starting'
  | 'running'
  | 'degraded'
  | 'stopping'
  | 'stopped'
  | 'failed';
export type ConnectionHealthState = 'idle' | 'healthy' | 'degraded' | 'failed';
export type AppRecoveryTrigger =
  | 'initial-load'
  | 'did-fail-load'
  | 'render-process-gone'
  | 'unresponsive'
  | 'child-process-gone'
  | 'uncaught-exception'
  | 'unhandled-rejection';
export type AppRecoveryOutcome =
  | 'reloaded'
  | 'recreated'
  | 'completed'
  | 'blocked'
  | 'fatal-exit-needed';

export interface XrayHealthStatus {
  state: XrayHealthState;
  ready: boolean;
  xrayRunning: boolean;
  lastStartAt: number | null;
  lastReadyAt: number | null;
  lastReadinessCheckAt: number | null;
  localProxyReachable: boolean | null;
  lastFailureAt: number | null;
  lastFailureReason: string | null;
  lastReadinessError: string | null;
}

export interface AppRecoveryStatus {
  recoveryInProgress: boolean;
  recoveryAttemptCount: number;
  recoveryBlocked: boolean;
  lastRecoveryAt: number | null;
  lastRecoveryTrigger: AppRecoveryTrigger | null;
  lastRecoveryOutcome: AppRecoveryOutcome | null;
  lastRecoveryReason: string | null;
  lastFatalReason: string | null;
}

export interface ConnectionMonitorStatus {
  isConnected: boolean;
  currentServer: SafeVlessConfig | null;
  lastError: string | null;
  connectionAttempts: number;
  lastConnectionTime: number | null;
  blockedServers: string[];
  autoSwitchingEnabled: boolean;
  lastHealthCheckAt: number | null;
  lastHealthState: ConnectionHealthState;
  lastHealthFailureReason: string | null;
  localProxyReachable: boolean | null;
  xrayState: XrayHealthState;
  xrayReady: boolean;
  xrayRunning: boolean;
  xrayLastStartAt: number | null;
  xrayLastReadyAt: number | null;
  xrayLastReadinessCheckAt: number | null;
  xrayLocalProxyReachable: boolean | null;
  xrayLastFailureAt: number | null;
  xrayLastFailureReason: string | null;
  xrayLastReadinessError: string | null;
  recoveryInProgress: boolean;
  recoveryAttemptCount: number;
  recoveryBlocked: boolean;
  lastRecoveryAt: number | null;
  lastRecoveryTrigger: AppRecoveryTrigger | null;
  lastRecoveryOutcome: AppRecoveryOutcome | null;
  lastRecoveryReason: string | null;
  lastFatalReason: string | null;
}

export interface TunCapabilityStatus {
  platform: string;
  supported: boolean;
  hasPrivileges: boolean;
  privilegeHint: string | null;
  unsupportedReason: string | null;
  routeMode: string | null;
  degradedReason: string | null;
}

export interface TrafficSnapshot {
  uploadBytes: number;
  downloadBytes: number;
  uploadBps: number;
  downloadBps: number;
  sessionDurationMs: number;
  connectedAt: number;
  sampledAt: number;
}

export type UpdateStage =
  | 'idle'
  | 'checking'
  | 'not-available'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'error'
  | 'disabled';

export interface UpdateStatus {
  stage: UpdateStage;
  version: string | null;
  releaseNotes: string | null;
  /** Download progress in percent (0-100). Only meaningful while downloading. */
  percent: number;
  /** Bytes/sec of download progress. Only meaningful while downloading. */
  bytesPerSecond: number;
  error: string | null;
  /** Epoch ms when this status was produced. */
  updatedAt: number;
}

export interface ImportMobileWhiteListResult {
  ok: boolean;
  configCount: number;
  error?: string;
}

export const IPC_INVOKE_CHANNELS = {
  connect: 'connect',
  disconnect: 'disconnect',
  getLogs: 'get-logs',
  openLogFolder: 'open-log-folder',
  openExternalUrl: 'open-external-url',
  importMobileWhiteListSubscription: 'import-mobile-white-list-subscription',
  getServers: 'get-servers',
  getSubscriptions: 'get-subscriptions',
  addSubscription: 'add-subscription',
  updateSubscription: 'update-subscription',
  deleteSubscription: 'delete-subscription',
  refreshSubscriptions: 'refresh-subscriptions',
  getManualLinks: 'get-manual-links',
  saveManualLinks: 'save-manual-links',
  getSelectedServerId: 'get-selected-server-id',
  setSelectedServerId: 'set-selected-server-id',
  getConnectionMode: 'get-connection-mode',
  setConnectionMode: 'set-connection-mode',
  getConnectionStatus: 'get-connection-status',
  getConnectionBusy: 'get-connection-busy',
  getAppVersion: 'get-app-version',
  pingServer: 'ping-server',
  pingAllServers: 'ping-all-servers',
  getConnectionMonitorStatus: 'get-connection-monitor-status',
  getTunCapabilityStatus: 'get-tun-capability-status',
  setAutoSwitching: 'set-auto-switching',
  clearBlockedServers: 'clear-blocked-servers',
  getPerformanceSettings: 'get-performance-settings',
  setPerformanceSettings: 'set-performance-settings',
  getUiLanguage: 'get-ui-language',
  setUiLanguage: 'set-ui-language',
  getTrafficStats: 'get-traffic-stats',
  getUpdateStatus: 'get-update-status',
  checkForUpdates: 'check-for-updates',
  installUpdate: 'install-update',
} as const;

export const IPC_EVENT_CHANNELS = {
  updateServers: 'update-servers',
  updateServerPings: 'update-server-pings',
  updateSubscriptions: 'update-subscriptions',
  connectionStatus: 'connection-status',
  connectionBusy: 'connection-busy',
  connectionError: 'connection-error',
  connectionMonitorEvent: 'connection-monitor-event',
  trafficStats: 'traffic-stats',
  updateStatus: 'update-status',
} as const;

export type { Subscription, PerformanceSettings };

export type IpcInvokeChannel =
  (typeof IPC_INVOKE_CHANNELS)[keyof typeof IPC_INVOKE_CHANNELS];
export type IpcEventChannel =
  (typeof IPC_EVENT_CHANNELS)[keyof typeof IPC_EVENT_CHANNELS];

export type IpcConnectionMode = ConnectionMode;

export interface IpcInvokeMap {
  [IPC_INVOKE_CHANNELS.connect]: {
    args: [server: VlessConfig];
    result: ConnectResult;
  };
  [IPC_INVOKE_CHANNELS.disconnect]: {
    args: [];
    result: DisconnectResult;
  };
  [IPC_INVOKE_CHANNELS.getLogs]: { args: []; result: string };
  [IPC_INVOKE_CHANNELS.openLogFolder]: { args: []; result: boolean };
  [IPC_INVOKE_CHANNELS.openExternalUrl]: {
    args: [url: string];
    result: boolean;
  };
  [IPC_INVOKE_CHANNELS.importMobileWhiteListSubscription]: {
    args: [];
    result: ImportMobileWhiteListResult;
  };
  [IPC_INVOKE_CHANNELS.getServers]: { args: []; result: SafeVlessConfig[] };
  [IPC_INVOKE_CHANNELS.getSubscriptions]: {
    args: [];
    result: Subscription[];
  };
  [IPC_INVOKE_CHANNELS.addSubscription]: {
    args: [payload: AddSubscriptionPayload];
    result: AddSubscriptionResult & { subscriptionId: string };
  };
  [IPC_INVOKE_CHANNELS.updateSubscription]: {
    args: [payload: UpdateSubscriptionPayload];
    result: boolean;
  };
  [IPC_INVOKE_CHANNELS.deleteSubscription]: {
    args: [payload: { id: string }];
    result: boolean;
  };
  [IPC_INVOKE_CHANNELS.refreshSubscriptions]: {
    args: [];
    result: RefreshSubscriptionsResult;
  };
  [IPC_INVOKE_CHANNELS.getManualLinks]: { args: []; result: string };
  [IPC_INVOKE_CHANNELS.saveManualLinks]: {
    args: [manualLinks: string];
    result: SaveManualLinksResult;
  };
  [IPC_INVOKE_CHANNELS.getSelectedServerId]: {
    args: [];
    result: string | null;
  };
  [IPC_INVOKE_CHANNELS.setSelectedServerId]: {
    args: [serverId: string | null];
    result: boolean;
  };
  [IPC_INVOKE_CHANNELS.getConnectionMode]: {
    args: [];
    result: ConnectionMode;
  };
  [IPC_INVOKE_CHANNELS.setConnectionMode]: {
    args: [mode: ConnectionMode];
    result: boolean;
  };
  [IPC_INVOKE_CHANNELS.getConnectionStatus]: { args: []; result: boolean };
  [IPC_INVOKE_CHANNELS.getConnectionBusy]: { args: []; result: boolean };
  [IPC_INVOKE_CHANNELS.getAppVersion]: { args: []; result: string };
  [IPC_INVOKE_CHANNELS.pingServer]: {
    args: [server: VlessConfig];
    result: PingResult;
  };
  [IPC_INVOKE_CHANNELS.pingAllServers]: {
    args: [force?: boolean];
    result: PingResult[];
  };
  [IPC_INVOKE_CHANNELS.getConnectionMonitorStatus]: {
    args: [];
    result: ConnectionMonitorStatus;
  };
  [IPC_INVOKE_CHANNELS.getTunCapabilityStatus]: {
    args: [];
    result: TunCapabilityStatus;
  };
  [IPC_INVOKE_CHANNELS.setAutoSwitching]: {
    args: [enabled: boolean];
    result: boolean;
  };
  [IPC_INVOKE_CHANNELS.clearBlockedServers]: { args: []; result: boolean };
  [IPC_INVOKE_CHANNELS.getPerformanceSettings]: {
    args: [];
    result: PerformanceSettings;
  };
  [IPC_INVOKE_CHANNELS.setPerformanceSettings]: {
    args: [settings: PerformanceSettings];
    result: boolean;
  };
  [IPC_INVOKE_CHANNELS.getUiLanguage]: { args: []; result: 'en' | 'ru' };
  [IPC_INVOKE_CHANNELS.setUiLanguage]: {
    args: [language: 'en' | 'ru'];
    result: boolean;
  };
  [IPC_INVOKE_CHANNELS.getTrafficStats]: {
    args: [];
    result: TrafficSnapshot | null;
  };
  [IPC_INVOKE_CHANNELS.getUpdateStatus]: { args: []; result: UpdateStatus };
  [IPC_INVOKE_CHANNELS.checkForUpdates]: { args: []; result: UpdateStatus };
  [IPC_INVOKE_CHANNELS.installUpdate]: { args: []; result: boolean };
}

export interface IpcEventMap {
  [IPC_EVENT_CHANNELS.updateServers]: SafeVlessConfig[];
  [IPC_EVENT_CHANNELS.updateServerPings]: ServerPingPatch[];
  [IPC_EVENT_CHANNELS.updateSubscriptions]: Subscription[];
  [IPC_EVENT_CHANNELS.connectionStatus]: boolean;
  [IPC_EVENT_CHANNELS.connectionBusy]: boolean;
  [IPC_EVENT_CHANNELS.connectionError]: string;
  [IPC_EVENT_CHANNELS.connectionMonitorEvent]: ConnectionMonitorEvent;
  [IPC_EVENT_CHANNELS.trafficStats]: TrafficSnapshot | null;
  [IPC_EVENT_CHANNELS.updateStatus]: UpdateStatus;
}
