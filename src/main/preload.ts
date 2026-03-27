import { contextBridge, ipcRenderer } from 'electron';
import { ConnectionMode, VlessConfig } from '../shared/types';
import {
  ConnectResult,
  ConnectionMonitorEvent,
  ConnectionMonitorStatus,
  DisconnectResult,
  IPC_EVENT_CHANNELS,
  IPC_INVOKE_CHANNELS,
  PingResult,
  SaveSubscriptionPayload,
} from '../shared/ipc';

function createListener<T>(channel: string) {
  return (callback: (data: T) => void): (() => void) => {
    const listener = (_: Electron.IpcRendererEvent, data: T) => callback(data);
    ipcRenderer.on(channel, listener);
    return () => { ipcRenderer.removeListener(channel, listener); };
  };
}

contextBridge.exposeInMainWorld('electronAPI', {
  connect: (server: VlessConfig) =>
    ipcRenderer.invoke(IPC_INVOKE_CHANNELS.connect, server) as Promise<ConnectResult>,
  disconnect: () =>
    ipcRenderer.invoke(IPC_INVOKE_CHANNELS.disconnect) as Promise<DisconnectResult>,
  saveSubscription: (payload: SaveSubscriptionPayload) =>
    ipcRenderer.invoke(IPC_INVOKE_CHANNELS.saveSubscription, payload) as Promise<boolean>,

  onUpdateServers: createListener<VlessConfig[]>(IPC_EVENT_CHANNELS.updateServers),
  onManualLinksUpdated: createListener<string>(IPC_EVENT_CHANNELS.manualLinksUpdated),
  onConnectionStatus: createListener<boolean>(IPC_EVENT_CHANNELS.connectionStatus),
  onConnectionBusy: createListener<boolean>(IPC_EVENT_CHANNELS.connectionBusy),
  onConnectionError: createListener<string>(IPC_EVENT_CHANNELS.connectionError),
  onConnectionMonitorEvent: createListener<ConnectionMonitorEvent>(IPC_EVENT_CHANNELS.connectionMonitorEvent),

  getConnectionMonitorStatus: () =>
    ipcRenderer.invoke(IPC_INVOKE_CHANNELS.getConnectionMonitorStatus) as Promise<ConnectionMonitorStatus>,
  setAutoSwitching: (enabled: boolean) => ipcRenderer.invoke(IPC_INVOKE_CHANNELS.setAutoSwitching, enabled) as Promise<boolean>,
  clearBlockedServers: () => ipcRenderer.invoke(IPC_INVOKE_CHANNELS.clearBlockedServers) as Promise<boolean>,

  getServers: () => ipcRenderer.invoke(IPC_INVOKE_CHANNELS.getServers) as Promise<VlessConfig[]>,
  getSubscriptionUrl: () => ipcRenderer.invoke(IPC_INVOKE_CHANNELS.getSubscriptionUrl) as Promise<string>,
  getManualLinks: () => ipcRenderer.invoke(IPC_INVOKE_CHANNELS.getManualLinks) as Promise<string>,
  getSelectedServerId: () => ipcRenderer.invoke(IPC_INVOKE_CHANNELS.getSelectedServerId) as Promise<string | null>,
  setSelectedServerId: (serverId: string | null) =>
    ipcRenderer.invoke(IPC_INVOKE_CHANNELS.setSelectedServerId, serverId) as Promise<boolean>,
  getConnectionMode: () => ipcRenderer.invoke(IPC_INVOKE_CHANNELS.getConnectionMode) as Promise<ConnectionMode>,
  setConnectionMode: (mode: ConnectionMode) => ipcRenderer.invoke(IPC_INVOKE_CHANNELS.setConnectionMode, mode) as Promise<boolean>,
  getConnectionStatus: () => ipcRenderer.invoke(IPC_INVOKE_CHANNELS.getConnectionStatus) as Promise<boolean>,
  getConnectionBusy: () => ipcRenderer.invoke(IPC_INVOKE_CHANNELS.getConnectionBusy) as Promise<boolean>,
  getLogs: () => ipcRenderer.invoke(IPC_INVOKE_CHANNELS.getLogs) as Promise<string>,
  openLogFolder: () => ipcRenderer.invoke(IPC_INVOKE_CHANNELS.openLogFolder) as Promise<boolean>,
  getAppVersion: () => ipcRenderer.invoke(IPC_INVOKE_CHANNELS.getAppVersion) as Promise<string>,

  pingServer: (server: VlessConfig) => ipcRenderer.invoke(IPC_INVOKE_CHANNELS.pingServer, server) as Promise<PingResult>,
  pingAllServers: (force?: boolean) => ipcRenderer.invoke(IPC_INVOKE_CHANNELS.pingAllServers, force) as Promise<PingResult[]>,
});
