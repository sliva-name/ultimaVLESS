import { ConnectionMode, VlessConfig } from '../shared/types';

export interface ConnectionMonitorEvent {
  type: 'connected' | 'disconnected' | 'error' | 'blocked' | 'switching';
  server: VlessConfig | null;
  error?: string;
  message?: string;
}

export interface ConnectionStatus {
  isConnected: boolean;
  currentServer: VlessConfig | null;
  lastError: string | null;
  connectionAttempts: number;
  lastConnectionTime: number | null;
  blockedServers: string[];
  autoSwitchingEnabled?: boolean;
}

export interface IElectronAPI {
  connect: (server: VlessConfig) => Promise<{ ok: boolean; error?: string; relaunched?: boolean }>;
  disconnect: () => Promise<{ ok: boolean }>;
  saveSubscription: (payload: { subscriptionUrl: string; manualLinks: string }) => Promise<boolean>;
  onUpdateServers: (callback: (servers: VlessConfig[]) => void) => () => void;
  onConnectionStatus: (callback: (status: boolean) => void) => () => void;
  onConnectionError: (callback: (error: string) => void) => () => void;
  onConnectionMonitorEvent: (callback: (event: ConnectionMonitorEvent) => void) => () => void;
  getConnectionMonitorStatus: () => Promise<ConnectionStatus>;
  setAutoSwitching: (enabled: boolean) => Promise<boolean>;
  clearBlockedServers: () => Promise<boolean>;
  getServers: () => Promise<VlessConfig[]>;
  getSubscriptionUrl: () => Promise<string>;
  getManualLinks: () => Promise<string>;
  getSelectedServerId: () => Promise<string | null>;
  getConnectionMode: () => Promise<ConnectionMode>;
  setConnectionMode: (mode: ConnectionMode) => Promise<boolean>;
  getConnectionStatus: () => Promise<boolean>;
  getLogs: () => Promise<string>;
  openLogFolder: () => Promise<boolean>;
  getAppVersion: () => Promise<string>;
  pingServer: (server: VlessConfig) => Promise<{ uuid: string; latency: number | null }>;
  pingAllServers: (force?: boolean) => Promise<Array<{ uuid: string; latency: number | null }>>;
}

declare global {
  interface Window {
    electronAPI: IElectronAPI;
  }
}
