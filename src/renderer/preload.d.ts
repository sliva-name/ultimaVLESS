import { ConnectionMode, Subscription, VlessConfig } from '@/shared/types';
import {
  AddSubscriptionPayload,
  AddSubscriptionResult,
  ConnectResult,
  ConnectionMonitorEvent,
  ConnectionMonitorStatus,
  DisconnectResult,
  ImportMobileWhiteListResult,
  PerformanceSettings,
  PingResult,
  RefreshSubscriptionsResult,
  SaveManualLinksResult,
  TrafficSnapshot,
  TunCapabilityStatus,
  UpdateStatus,
  UpdateSubscriptionPayload,
} from '@/shared/ipc';

export type ConnectionStatus = ConnectionMonitorStatus;
export type { ConnectionMonitorEvent };

export interface IElectronAPI {
  connect: (server: VlessConfig) => Promise<ConnectResult>;
  disconnect: () => Promise<DisconnectResult>;

  // Subscriptions CRUD
  getSubscriptions: () => Promise<Subscription[]>;
  addSubscription: (payload: AddSubscriptionPayload) => Promise<AddSubscriptionResult & { subscriptionId: string }>;
  updateSubscription: (payload: UpdateSubscriptionPayload) => Promise<boolean>;
  deleteSubscription: (id: string) => Promise<boolean>;
  refreshSubscriptions: () => Promise<RefreshSubscriptionsResult>;

  // Manual links
  getManualLinks: () => Promise<string>;
  saveManualLinks: (manualLinks: string) => Promise<SaveManualLinksResult>;

  // Events
  onUpdateServers: (callback: (servers: VlessConfig[]) => void) => () => void;
  onUpdateSubscriptions: (callback: (subscriptions: Subscription[]) => void) => () => void;
  onConnectionStatus: (callback: (status: boolean) => void) => () => void;
  onConnectionBusy: (callback: (busy: boolean) => void) => () => void;
  onConnectionError: (callback: (error: string) => void) => () => void;
  onConnectionMonitorEvent: (callback: (event: ConnectionMonitorEvent) => void) => () => void;
  onTrafficStats: (callback: (snapshot: TrafficSnapshot | null) => void) => () => void;
  onUpdateStatus: (callback: (status: UpdateStatus) => void) => () => void;

  getConnectionMonitorStatus: () => Promise<ConnectionMonitorStatus>;
  setAutoSwitching: (enabled: boolean) => Promise<boolean>;
  clearBlockedServers: () => Promise<boolean>;
  getServers: () => Promise<VlessConfig[]>;
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
  getPerformanceSettings: () => Promise<PerformanceSettings>;
  setPerformanceSettings: (settings: PerformanceSettings) => Promise<boolean>;

  getUiLanguage: () => Promise<'en' | 'ru'>;
  setUiLanguage: (language: 'en' | 'ru') => Promise<boolean>;

  getTrafficStats: () => Promise<TrafficSnapshot | null>;

  getUpdateStatus: () => Promise<UpdateStatus>;
  checkForUpdates: () => Promise<UpdateStatus>;
  installUpdate: () => Promise<boolean>;
}

declare global {
  interface Window {
    electronAPI: IElectronAPI;
  }
}
