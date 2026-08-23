import { contextBridge, ipcRenderer } from 'electron';
import { ConnectionMode, VlessConfig } from '@/shared/types';
import {
  AddSubscriptionPayload,
  AddSubscriptionResult,
  AppSnapshot,
  ConnectResult,
  ConnectionMonitorEvent,
  DisconnectResult,
  IPC_EVENT_CHANNELS,
  IPC_INVOKE_CHANNELS,
  ImportMobileWhiteListResult,
  PerformanceSettings,
  PingResult,
  RefreshSubscriptionsResult,
  SaveManualLinksResult,
  TunCapabilityStatus,
  UpdateStatus,
  UpdateSubscriptionPayload,
} from '@/shared/ipc';

function createListener<T>(channel: string) {
  return (callback: (data: T) => void): (() => void) => {
    const listener = (_: Electron.IpcRendererEvent, data: T) => callback(data);
    ipcRenderer.on(channel, listener);
    return () => {
      ipcRenderer.removeListener(channel, listener);
    };
  };
}

contextBridge.exposeInMainWorld('electronAPI', {
  connect: (serverId: string) =>
    ipcRenderer.invoke(
      IPC_INVOKE_CHANNELS.connect,
      serverId,
    ) as Promise<ConnectResult>,
  disconnect: () =>
    ipcRenderer.invoke(
      IPC_INVOKE_CHANNELS.disconnect,
    ) as Promise<DisconnectResult>,

  // Subscriptions CRUD
  addSubscription: (payload: AddSubscriptionPayload) =>
    ipcRenderer.invoke(IPC_INVOKE_CHANNELS.addSubscription, payload) as Promise<
      AddSubscriptionResult & { subscriptionId: string }
    >,
  updateSubscription: (payload: UpdateSubscriptionPayload) =>
    ipcRenderer.invoke(
      IPC_INVOKE_CHANNELS.updateSubscription,
      payload,
    ) as Promise<boolean>,
  deleteSubscription: (id: string) =>
    ipcRenderer.invoke(IPC_INVOKE_CHANNELS.deleteSubscription, {
      id,
    }) as Promise<boolean>,
  refreshSubscriptions: () =>
    ipcRenderer.invoke(
      IPC_INVOKE_CHANNELS.refreshSubscriptions,
    ) as Promise<RefreshSubscriptionsResult>,

  // Manual links
  getManualLinks: () =>
    ipcRenderer.invoke(IPC_INVOKE_CHANNELS.getManualLinks) as Promise<string>,
  saveManualLinks: (manualLinks: string) =>
    ipcRenderer.invoke(
      IPC_INVOKE_CHANNELS.saveManualLinks,
      manualLinks,
    ) as Promise<SaveManualLinksResult>,

  // Events
  onAppSnapshotChanged: createListener<AppSnapshot>(
    IPC_EVENT_CHANNELS.appSnapshotChanged,
  ),
  onConnectionMonitorEvent: createListener<ConnectionMonitorEvent>(
    IPC_EVENT_CHANNELS.connectionMonitorEvent,
  ),
  onUpdateStatus: createListener<UpdateStatus>(IPC_EVENT_CHANNELS.updateStatus),

  setAutoSwitching: (enabled: boolean) =>
    ipcRenderer.invoke(
      IPC_INVOKE_CHANNELS.setAutoSwitching,
      enabled,
    ) as Promise<boolean>,
  clearBlockedServers: () =>
    ipcRenderer.invoke(
      IPC_INVOKE_CHANNELS.clearBlockedServers,
    ) as Promise<boolean>,

  getAppSnapshot: () =>
    ipcRenderer.invoke(IPC_INVOKE_CHANNELS.getAppSnapshot) as Promise<AppSnapshot>,
  setSelectedServerId: (serverId: string | null) =>
    ipcRenderer.invoke(
      IPC_INVOKE_CHANNELS.setSelectedServerId,
      serverId,
    ) as Promise<boolean>,
  getConnectionMode: () =>
    ipcRenderer.invoke(
      IPC_INVOKE_CHANNELS.getConnectionMode,
    ) as Promise<ConnectionMode>,
  setConnectionMode: (mode: ConnectionMode) =>
    ipcRenderer.invoke(
      IPC_INVOKE_CHANNELS.setConnectionMode,
      mode,
    ) as Promise<boolean>,
  getTunCapabilityStatus: () =>
    ipcRenderer.invoke(
      IPC_INVOKE_CHANNELS.getTunCapabilityStatus,
    ) as Promise<TunCapabilityStatus>,
  getLogs: () =>
    ipcRenderer.invoke(IPC_INVOKE_CHANNELS.getLogs) as Promise<string>,
  openLogFolder: () =>
    ipcRenderer.invoke(IPC_INVOKE_CHANNELS.openLogFolder) as Promise<boolean>,
  openExternalUrl: (url: string) =>
    ipcRenderer.invoke(
      IPC_INVOKE_CHANNELS.openExternalUrl,
      url,
    ) as Promise<boolean>,
  importMobileWhiteListSubscription: () =>
    ipcRenderer.invoke(
      IPC_INVOKE_CHANNELS.importMobileWhiteListSubscription,
    ) as Promise<ImportMobileWhiteListResult>,
  getAppVersion: () =>
    ipcRenderer.invoke(IPC_INVOKE_CHANNELS.getAppVersion) as Promise<string>,

  pingServer: (server: VlessConfig) =>
    ipcRenderer.invoke(
      IPC_INVOKE_CHANNELS.pingServer,
      server,
    ) as Promise<PingResult>,
  pingAllServers: (force?: boolean) =>
    ipcRenderer.invoke(IPC_INVOKE_CHANNELS.pingAllServers, force) as Promise<
      PingResult[]
    >,

  getPerformanceSettings: () =>
    ipcRenderer.invoke(
      IPC_INVOKE_CHANNELS.getPerformanceSettings,
    ) as Promise<PerformanceSettings>,
  setPerformanceSettings: (settings: PerformanceSettings) =>
    ipcRenderer.invoke(
      IPC_INVOKE_CHANNELS.setPerformanceSettings,
      settings,
    ) as Promise<boolean>,

  getUiLanguage: () =>
    ipcRenderer.invoke(IPC_INVOKE_CHANNELS.getUiLanguage) as Promise<
      'en' | 'ru'
    >,
  setUiLanguage: (language: 'en' | 'ru') =>
    ipcRenderer.invoke(
      IPC_INVOKE_CHANNELS.setUiLanguage,
      language,
    ) as Promise<boolean>,

  getUpdateStatus: () =>
    ipcRenderer.invoke(
      IPC_INVOKE_CHANNELS.getUpdateStatus,
    ) as Promise<UpdateStatus>,
  checkForUpdates: () =>
    ipcRenderer.invoke(
      IPC_INVOKE_CHANNELS.checkForUpdates,
    ) as Promise<UpdateStatus>,
  installUpdate: () =>
    ipcRenderer.invoke(IPC_INVOKE_CHANNELS.installUpdate) as Promise<boolean>,
});
