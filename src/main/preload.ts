import { contextBridge, ipcRenderer } from 'electron';
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
}

function createListener<T>(channel: string) {
  return (callback: (data: T) => void): (() => void) => {
    const listener = (_: Electron.IpcRendererEvent, data: T) => callback(data);
    ipcRenderer.on(channel, listener);
    return () => { ipcRenderer.removeListener(channel, listener); };
  };
}

contextBridge.exposeInMainWorld('electronAPI', {
  connect: (server: VlessConfig) =>
    ipcRenderer.invoke('connect', server) as Promise<{ ok: boolean; error?: string; relaunched?: boolean }>,
  disconnect: () =>
    ipcRenderer.invoke('disconnect') as Promise<{ ok: boolean }>,
  saveSubscription: (payload: { subscriptionUrl: string; manualLinks: string }) =>
    ipcRenderer.invoke('save-subscription', payload) as Promise<boolean>,

  onUpdateServers: createListener<VlessConfig[]>('update-servers'),
  onConnectionStatus: createListener<boolean>('connection-status'),
  onConnectionError: createListener<string>('connection-error'),
  onConnectionMonitorEvent: createListener<ConnectionMonitorEvent>('connection-monitor-event'),

  getConnectionMonitorStatus: () => ipcRenderer.invoke('get-connection-monitor-status') as Promise<ConnectionStatus>,
  setAutoSwitching: (enabled: boolean) => ipcRenderer.invoke('set-auto-switching', enabled) as Promise<boolean>,
  clearBlockedServers: () => ipcRenderer.invoke('clear-blocked-servers') as Promise<boolean>,

  getServers: () => ipcRenderer.invoke('get-servers'),
  getSubscriptionUrl: () => ipcRenderer.invoke('get-subscription-url'),
  getManualLinks: () => ipcRenderer.invoke('get-manual-links'),
  getSelectedServerId: () => ipcRenderer.invoke('get-selected-server-id'),
  setSelectedServerId: (serverId: string | null) => ipcRenderer.invoke('set-selected-server-id', serverId) as Promise<boolean>,
  getConnectionMode: () => ipcRenderer.invoke('get-connection-mode') as Promise<ConnectionMode>,
  setConnectionMode: (mode: ConnectionMode) => ipcRenderer.invoke('set-connection-mode', mode) as Promise<boolean>,
  getConnectionStatus: () => ipcRenderer.invoke('get-connection-status'),
  getLogs: () => ipcRenderer.invoke('get-logs'),
  openLogFolder: () => ipcRenderer.invoke('open-log-folder') as Promise<boolean>,
  getAppVersion: () => ipcRenderer.invoke('get-app-version') as Promise<string>,

  pingServer: (server: VlessConfig) => ipcRenderer.invoke('ping-server', server) as Promise<{ uuid: string; latency: number | null }>,
  pingAllServers: (force?: boolean) => ipcRenderer.invoke('ping-all-servers', force) as Promise<Array<{ uuid: string; latency: number | null }>>,
});
