import { VlessConfig } from '../shared/types';

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
  connect: (server: VlessConfig) => void;
  disconnect: () => void;
  saveSubscription: (url: string) => Promise<void>;
  onUpdateServers: (callback: (servers: VlessConfig[]) => void) => void;
  onConnectionStatus: (callback: (status: boolean) => void) => void;
  onLogs: (callback: (logs: string[]) => void) => void;
  
  // Connection monitoring
  onConnectionMonitorEvent: (callback: (event: ConnectionMonitorEvent) => void) => void;
  getConnectionMonitorStatus: () => Promise<ConnectionStatus>;
  setAutoSwitching: (enabled: boolean) => Promise<boolean>;
  clearBlockedServers: () => Promise<boolean>;
  
  getServers: () => Promise<VlessConfig[]>;
  getSubscriptionUrl: () => Promise<string>;
  getSelectedServerId: () => Promise<string | null>;
  getConnectionStatus: () => Promise<boolean>;
  getLogs: () => Promise<string>;
  openLogFolder: () => void;
  getAppVersion: () => Promise<string>;
  
  // Ping methods
  pingServer: (server: VlessConfig) => Promise<{ uuid: string; latency: number | null }>;
  pingAllServers: (force?: boolean) => Promise<Array<{ uuid: string; latency: number | null }>>;
}

declare global {
  interface Window {
    electronAPI: IElectronAPI;
  }
}

