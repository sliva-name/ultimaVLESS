import { contextBridge, ipcRenderer } from 'electron';
import { ConnectionMode, Subscription, VlessConfig } from '@/shared/types';
import {
  AddSubscriptionPayload,
  AddSubscriptionResult,
  ConnectResult,
  ConnectionMonitorEvent,
  ConnectionMonitorStatus,
  DisconnectResult,
  IPC_EVENT_CHANNELS,
  IPC_INVOKE_CHANNELS,
  ImportMobileWhiteListResult,
  PerformanceSettings,
  PingResult,
  RefreshSubscriptionsResult,
  SaveManualLinksResult,
  TrafficSnapshot,
  TunCapabilityStatus,
  UpdateSubscriptionPayload,
} from '@/shared/ipc';

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

  // Subscriptions CRUD
  getSubscriptions: () =>
    ipcRenderer.invoke(IPC_INVOKE_CHANNELS.getSubscriptions) as Promise<Subscription[]>,
  addSubscription: (payload: AddSubscriptionPayload) =>
    ipcRenderer.invoke(IPC_INVOKE_CHANNELS.addSubscription, payload) as Promise<AddSubscriptionResult & { subscriptionId: string }>,
  updateSubscription: (payload: UpdateSubscriptionPayload) =>
    ipcRenderer.invoke(IPC_INVOKE_CHANNELS.updateSubscription, payload) as Promise<boolean>,
  deleteSubscription: (id: string) =>
    ipcRenderer.invoke(IPC_INVOKE_CHANNELS.deleteSubscription, { id }) as Promise<boolean>,
  refreshSubscriptions: () =>
    ipcRenderer.invoke(IPC_INVOKE_CHANNELS.refreshSubscriptions) as Promise<RefreshSubscriptionsResult>,

  // Manual links
  getManualLinks: () => ipcRenderer.invoke(IPC_INVOKE_CHANNELS.getManualLinks) as Promise<string>,
  saveManualLinks: (manualLinks: string) =>
    ipcRenderer.invoke(IPC_INVOKE_CHANNELS.saveManualLinks, manualLinks) as Promise<SaveManualLinksResult>,

  // Events
  onUpdateServers: createListener<VlessConfig[]>(IPC_EVENT_CHANNELS.updateServers),
  onUpdateSubscriptions: createListener<Subscription[]>(IPC_EVENT_CHANNELS.updateSubscriptions),
  onConnectionStatus: createListener<boolean>(IPC_EVENT_CHANNELS.connectionStatus),
  onConnectionBusy: createListener<boolean>(IPC_EVENT_CHANNELS.connectionBusy),
  onConnectionError: createListener<string>(IPC_EVENT_CHANNELS.connectionError),
  onConnectionMonitorEvent: createListener<ConnectionMonitorEvent>(IPC_EVENT_CHANNELS.connectionMonitorEvent),
  onTrafficStats: createListener<TrafficSnapshot | null>(IPC_EVENT_CHANNELS.trafficStats),

  getConnectionMonitorStatus: () =>
    ipcRenderer.invoke(IPC_INVOKE_CHANNELS.getConnectionMonitorStatus) as Promise<ConnectionMonitorStatus>,
  setAutoSwitching: (enabled: boolean) => ipcRenderer.invoke(IPC_INVOKE_CHANNELS.setAutoSwitching, enabled) as Promise<boolean>,
  clearBlockedServers: () => ipcRenderer.invoke(IPC_INVOKE_CHANNELS.clearBlockedServers) as Promise<boolean>,

  getServers: () => ipcRenderer.invoke(IPC_INVOKE_CHANNELS.getServers) as Promise<VlessConfig[]>,
  getSelectedServerId: () => ipcRenderer.invoke(IPC_INVOKE_CHANNELS.getSelectedServerId) as Promise<string | null>,
  setSelectedServerId: (serverId: string | null) =>
    ipcRenderer.invoke(IPC_INVOKE_CHANNELS.setSelectedServerId, serverId) as Promise<boolean>,
  getConnectionMode: () => ipcRenderer.invoke(IPC_INVOKE_CHANNELS.getConnectionMode) as Promise<ConnectionMode>,
  setConnectionMode: (mode: ConnectionMode) => ipcRenderer.invoke(IPC_INVOKE_CHANNELS.setConnectionMode, mode) as Promise<boolean>,
  getTunCapabilityStatus: () =>
    ipcRenderer.invoke(IPC_INVOKE_CHANNELS.getTunCapabilityStatus) as Promise<TunCapabilityStatus>,
  getConnectionStatus: () => ipcRenderer.invoke(IPC_INVOKE_CHANNELS.getConnectionStatus) as Promise<boolean>,
  getConnectionBusy: () => ipcRenderer.invoke(IPC_INVOKE_CHANNELS.getConnectionBusy) as Promise<boolean>,
  getLogs: () => ipcRenderer.invoke(IPC_INVOKE_CHANNELS.getLogs) as Promise<string>,
  openLogFolder: () => ipcRenderer.invoke(IPC_INVOKE_CHANNELS.openLogFolder) as Promise<boolean>,
  openExternalUrl: (url: string) =>
    ipcRenderer.invoke(IPC_INVOKE_CHANNELS.openExternalUrl, url) as Promise<boolean>,
  importMobileWhiteListSubscription: () =>
    ipcRenderer.invoke(IPC_INVOKE_CHANNELS.importMobileWhiteListSubscription) as Promise<ImportMobileWhiteListResult>,
  getAppVersion: () => ipcRenderer.invoke(IPC_INVOKE_CHANNELS.getAppVersion) as Promise<string>,

  pingServer: (server: VlessConfig) => ipcRenderer.invoke(IPC_INVOKE_CHANNELS.pingServer, server) as Promise<PingResult>,
  pingAllServers: (force?: boolean) => ipcRenderer.invoke(IPC_INVOKE_CHANNELS.pingAllServers, force) as Promise<PingResult[]>,

  getPerformanceSettings: () =>
    ipcRenderer.invoke(IPC_INVOKE_CHANNELS.getPerformanceSettings) as Promise<PerformanceSettings>,
  setPerformanceSettings: (settings: PerformanceSettings) =>
    ipcRenderer.invoke(IPC_INVOKE_CHANNELS.setPerformanceSettings, settings) as Promise<boolean>,

  getUiLanguage: () => ipcRenderer.invoke(IPC_INVOKE_CHANNELS.getUiLanguage) as Promise<'en' | 'ru'>,
  setUiLanguage: (language: 'en' | 'ru') =>
    ipcRenderer.invoke(IPC_INVOKE_CHANNELS.setUiLanguage, language) as Promise<boolean>,

  getTrafficStats: () => ipcRenderer.invoke(IPC_INVOKE_CHANNELS.getTrafficStats) as Promise<TrafficSnapshot | null>,
});
