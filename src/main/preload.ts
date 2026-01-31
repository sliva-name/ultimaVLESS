import { contextBridge, ipcRenderer } from 'electron';
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
}

contextBridge.exposeInMainWorld('electronAPI', {
  connect: (server: VlessConfig) => ipcRenderer.send('connect', server),
  disconnect: () => ipcRenderer.send('disconnect'),
  saveSubscription: (url: string) => ipcRenderer.invoke('save-subscription', url),
  onUpdateServers: (callback: (servers: VlessConfig[]) => void) => 
    ipcRenderer.on('update-servers', (_, servers) => callback(servers)),
  onConnectionStatus: (callback: (status: boolean) => void) =>
    ipcRenderer.on('connection-status', (_, status) => callback(status)),
  onLogs: (callback: (logs: string[]) => void) =>
    ipcRenderer.on('logs-update', (_, logs) => callback(logs)),
  
  // Connection monitoring
  onConnectionMonitorEvent: (callback: (event: ConnectionMonitorEvent) => void) =>
    ipcRenderer.on('connection-monitor-event', (_, event) => callback(event)),
  getConnectionMonitorStatus: () => ipcRenderer.invoke('get-connection-monitor-status') as Promise<ConnectionStatus>,
  setAutoSwitching: (enabled: boolean) => ipcRenderer.invoke('set-auto-switching', enabled) as Promise<boolean>,
  clearBlockedServers: () => ipcRenderer.invoke('clear-blocked-servers') as Promise<boolean>,
  
  // Request initial state
  getServers: () => ipcRenderer.invoke('get-servers'),
  getSubscriptionUrl: () => ipcRenderer.invoke('get-subscription-url'),
  getSelectedServerId: () => ipcRenderer.invoke('get-selected-server-id'),
  getConnectionStatus: () => ipcRenderer.invoke('get-connection-status'),
  getLogs: () => ipcRenderer.invoke('get-logs'),
  openLogFolder: () => ipcRenderer.send('open-log-folder'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version') as Promise<string>,
  
  // Ping methods
  pingServer: (server: VlessConfig) => ipcRenderer.invoke('ping-server', server) as Promise<{ uuid: string; latency: number | null }>,
  pingAllServers: (force?: boolean) => ipcRenderer.invoke('ping-all-servers', force) as Promise<Array<{ uuid: string; latency: number | null }>>,
});

