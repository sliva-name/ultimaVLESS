import { ConnectionMode, VlessConfig } from './types';

export interface ConnectResult {
  ok: boolean;
  error?: string;
  relaunched?: boolean;
}

export interface DisconnectResult {
  ok: boolean;
}

export interface SaveSubscriptionPayload {
  subscriptionUrl: string;
  manualLinks: string;
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

export interface ConnectionMonitorStatus {
  isConnected: boolean;
  currentServer: VlessConfig | null;
  lastError: string | null;
  connectionAttempts: number;
  lastConnectionTime: number | null;
  blockedServers: string[];
  autoSwitchingEnabled: boolean;
}

export interface TunCapabilityStatus {
  platform: string;
  supported: boolean;
  hasPrivileges: boolean;
  privilegeHint: string | null;
  unsupportedReason: string | null;
}

export interface ImportMobileWhiteListResult {
  ok: boolean;
  configCount: number;
  error?: string;
}

export const IPC_INVOKE_CHANNELS = {
  connect: 'connect',
  disconnect: 'disconnect',
  saveSubscription: 'save-subscription',
  getLogs: 'get-logs',
  openLogFolder: 'open-log-folder',
  openExternalUrl: 'open-external-url',
  importMobileWhiteListSubscription: 'import-mobile-white-list-subscription',
  getServers: 'get-servers',
  getSubscriptionUrl: 'get-subscription-url',
  getManualLinks: 'get-manual-links',
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
} as const;

export const IPC_EVENT_CHANNELS = {
  updateServers: 'update-servers',
  manualLinksUpdated: 'manual-links-updated',
  connectionStatus: 'connection-status',
  connectionBusy: 'connection-busy',
  connectionError: 'connection-error',
  connectionMonitorEvent: 'connection-monitor-event',
} as const;

export type IpcInvokeChannel = typeof IPC_INVOKE_CHANNELS[keyof typeof IPC_INVOKE_CHANNELS];
export type IpcEventChannel = typeof IPC_EVENT_CHANNELS[keyof typeof IPC_EVENT_CHANNELS];

export type IpcConnectionMode = ConnectionMode;
