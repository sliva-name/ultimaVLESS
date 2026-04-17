import { ConnectionMode, PerformanceSettings, Subscription, VlessConfig } from './types';

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

export interface ConnectionMonitorEvent {
  type: 'connected' | 'disconnected' | 'error' | 'blocked' | 'switching';
  server: VlessConfig | null;
  error?: string;
  message?: string;
}

export type XrayHealthState = 'starting' | 'running' | 'degraded' | 'stopping' | 'stopped' | 'failed';
export type ConnectionHealthState = 'idle' | 'healthy' | 'degraded' | 'failed';
export type AppRecoveryTrigger =
  | 'initial-load'
  | 'did-fail-load'
  | 'render-process-gone'
  | 'unresponsive'
  | 'child-process-gone'
  | 'uncaught-exception'
  | 'unhandled-rejection';
export type AppRecoveryOutcome = 'reloaded' | 'recreated' | 'completed' | 'blocked' | 'fatal-exit-needed';

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
  currentServer: VlessConfig | null;
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
} as const;

export const IPC_EVENT_CHANNELS = {
  updateServers: 'update-servers',
  updateSubscriptions: 'update-subscriptions',
  connectionStatus: 'connection-status',
  connectionBusy: 'connection-busy',
  connectionError: 'connection-error',
  connectionMonitorEvent: 'connection-monitor-event',
} as const;

export type { Subscription, PerformanceSettings };

export type IpcInvokeChannel = typeof IPC_INVOKE_CHANNELS[keyof typeof IPC_INVOKE_CHANNELS];
export type IpcEventChannel = typeof IPC_EVENT_CHANNELS[keyof typeof IPC_EVENT_CHANNELS];

export type IpcConnectionMode = ConnectionMode;
