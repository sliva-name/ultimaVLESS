import { ConnectionMode, VlessConfig } from '../shared/types';
import {
  ConnectResult,
  ConnectionMonitorEvent,
  ConnectionMonitorStatus,
  DisconnectResult,
  ImportMobileWhiteListResult,
  PingResult,
  SaveSubscriptionPayload,
  TunCapabilityStatus,
} from '../shared/ipc';

export type ConnectionStatus = ConnectionMonitorStatus;
export type { ConnectionMonitorEvent };

export interface IElectronAPI {
  connect: (server: VlessConfig) => Promise<ConnectResult>;
  disconnect: () => Promise<DisconnectResult>;
  saveSubscription: (payload: SaveSubscriptionPayload) => Promise<boolean>;
  onUpdateServers: (callback: (servers: VlessConfig[]) => void) => () => void;
  onManualLinksUpdated: (callback: (manualLinks: string) => void) => () => void;
  onConnectionStatus: (callback: (status: boolean) => void) => () => void;
  onConnectionBusy: (callback: (busy: boolean) => void) => () => void;
  onConnectionError: (callback: (error: string) => void) => () => void;
  onConnectionMonitorEvent: (callback: (event: ConnectionMonitorEvent) => void) => () => void;
  getConnectionMonitorStatus: () => Promise<ConnectionMonitorStatus>;
  setAutoSwitching: (enabled: boolean) => Promise<boolean>;
  clearBlockedServers: () => Promise<boolean>;
  getServers: () => Promise<VlessConfig[]>;
  getSubscriptionUrl: () => Promise<string>;
  getManualLinks: () => Promise<string>;
  getSelectedServerId: () => Promise<string | null>;
  setSelectedServerId: (serverId: string | null) => Promise<boolean>;
  getConnectionMode: () => Promise<ConnectionMode>;
  setConnectionMode: (mode: ConnectionMode) => Promise<boolean>;
  getTunCapabilityStatus: () => Promise<TunCapabilityStatus>;
  getConnectionStatus: () => Promise<boolean>;
  getConnectionBusy: () => Promise<boolean>;
  getLogs: () => Promise<string>;
  openLogFolder: () => Promise<boolean>;
  openExternalUrl: (url: string) => Promise<boolean>;
  importMobileWhiteListSubscription: () => Promise<ImportMobileWhiteListResult>;
  getAppVersion: () => Promise<string>;
  pingServer: (server: VlessConfig) => Promise<PingResult>;
  pingAllServers: (force?: boolean) => Promise<PingResult[]>;
}

declare global {
  interface Window {
    electronAPI: IElectronAPI;
  }
}
