import type { IElectronAPI } from '@/shared/contracts/preloadApi';
import {
  IPC_EVENT_CHANNELS,
  IPC_INVOKE_CHANNELS,
  type IpcEventChannel,
} from '@/shared/ipc/channels';
import { invokeIpcHandler, type WebContents } from '../electron';

type Listener = (payload: unknown) => void;

const listeners = new Map<string, Set<Listener>>();

/**
 * Electron IPC copies every value across the process boundary; keep that, so
 * neither side can mutate the other's objects.
 */
function copy<T>(value: T): T {
  return value === undefined ? value : structuredClone(value);
}

/** The renderer's `webContents`: `send` delivers to `on*` subscribers. */
export const rendererContents: WebContents = {
  id: 1,
  send(channel: string, ...args: unknown[]): void {
    const subscribers = listeners.get(channel);
    if (!subscribers) return;
    for (const listener of [...subscribers]) {
      listener(copy(args[0]));
    }
  },
};

function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  return invokeIpcHandler(rendererContents, channel, copy(args)).then(
    (result) => copy(result) as T,
  );
}

function listen<T>(channel: IpcEventChannel) {
  return (callback: (data: T) => void): (() => void) => {
    const listener = callback as Listener;
    const set = listeners.get(channel) ?? new Set<Listener>();
    set.add(listener);
    listeners.set(channel, set);
    return () => {
      set.delete(listener);
    };
  };
}

const C = IPC_INVOKE_CHANNELS;

/** Same surface as `src/main/preload.ts`, without a process boundary. */
export const mobileElectronApi: IElectronAPI = {
  connect: (serverId) => invoke(C.connect, serverId),
  disconnect: () => invoke(C.disconnect),
  addSubscription: (payload) => invoke(C.addSubscription, payload),
  updateSubscription: (payload) => invoke(C.updateSubscription, payload),
  deleteSubscription: (id) => invoke(C.deleteSubscription, { id }),
  refreshSubscriptions: () => invoke(C.refreshSubscriptions),
  getManualLinks: () => invoke(C.getManualLinks),
  saveManualLinks: (manualLinks) => invoke(C.saveManualLinks, manualLinks),
  onAppSnapshotChanged: listen(IPC_EVENT_CHANNELS.appSnapshotChanged),
  onAppSnapshotPatch: listen(IPC_EVENT_CHANNELS.appSnapshotPatch),
  onConnectionMonitorEvent: listen(IPC_EVENT_CHANNELS.connectionMonitorEvent),
  onUpdateStatus: listen(IPC_EVENT_CHANNELS.updateStatus),
  setAutoSwitching: (enabled) => invoke(C.setAutoSwitching, enabled),
  clearBlockedServers: () => invoke(C.clearBlockedServers),
  getAppSnapshot: () => invoke(C.getAppSnapshot),
  setSelectedServerId: (serverId) => invoke(C.setSelectedServerId, serverId),
  getConnectionMode: () => invoke(C.getConnectionMode),
  setConnectionMode: (mode) => invoke(C.setConnectionMode, mode),
  getTunCapabilityStatus: () => invoke(C.getTunCapabilityStatus),
  listNetworkAdapters: () => invoke(C.listNetworkAdapters),
  scanConflictingApps: () => invoke(C.scanConflictingApps),
  closeConflictingApp: (appId) => invoke(C.closeConflictingApp, appId),
  getLogs: () => invoke(C.getLogs),
  openLogFolder: () => invoke(C.openLogFolder),
  openExternalUrl: (url) => invoke(C.openExternalUrl, url),
  importMobileWhiteListSubscription: () =>
    invoke(C.importMobileWhiteListSubscription),
  getAppVersion: () => invoke(C.getAppVersion),
  pingServer: (server) => invoke(C.pingServer, server),
  pingAllServers: (force, serverIds) =>
    invoke(C.pingAllServers, force, serverIds),
  stopPingAllServers: () => invoke(C.stopPingAllServers),
  getPerformanceSettings: () => invoke(C.getPerformanceSettings),
  setPerformanceSettings: (settings) =>
    invoke(C.setPerformanceSettings, settings),
  pickApplications: () => invoke(C.pickApplications),
  listRunningApps: () => invoke(C.listRunningApps),
  getUiLanguage: () => invoke(C.getUiLanguage),
  setUiLanguage: (language) => invoke(C.setUiLanguage, language),
  // Android draws no window buttons.
  setWindowTheme: async () => true,
  getUpdateStatus: () => invoke(C.getUpdateStatus),
  checkForUpdates: () => invoke(C.checkForUpdates),
  installUpdate: () => invoke(C.installUpdate),
};
