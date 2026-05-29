import type { ConnectionMode, VlessConfig } from '@/shared/types';
import type {
  AddSubscriptionPayload,
  AddSubscriptionResult,
  ConnectResult,
  DisconnectResult,
  ImportMobileWhiteListResult,
  PingResult,
  RefreshSubscriptionsResult,
  SaveManualLinksResult,
  UpdateSubscriptionPayload,
} from '@/shared/ipc/payloads';
import type { AppSnapshot } from '@/shared/views/appSnapshot';
import type {
  ConnectionMonitorEvent,
  ConnectionMonitorStatus,
  TunCapabilityStatus,
} from '@/shared/views/monitorStatus';
import type { UpdateStatus } from '@/shared/views/update';
import type { PerformanceSettings } from '@/shared/types';

export interface IElectronAPI {
  connect: (serverId: string) => Promise<ConnectResult>;
  disconnect: () => Promise<DisconnectResult>;

  addSubscription: (
    payload: AddSubscriptionPayload,
  ) => Promise<AddSubscriptionResult & { subscriptionId: string }>;
  updateSubscription: (payload: UpdateSubscriptionPayload) => Promise<boolean>;
  deleteSubscription: (id: string) => Promise<boolean>;
  refreshSubscriptions: () => Promise<RefreshSubscriptionsResult>;

  getManualLinks: () => Promise<string>;
  saveManualLinks: (manualLinks: string) => Promise<SaveManualLinksResult>;

  onAppSnapshotChanged: (callback: (snapshot: AppSnapshot) => void) => () => void;
  onConnectionMonitorEvent: (
    callback: (event: ConnectionMonitorEvent) => void,
  ) => () => void;
  onUpdateStatus: (callback: (status: UpdateStatus) => void) => () => void;

  getConnectionMonitorStatus: () => Promise<ConnectionMonitorStatus>;
  setAutoSwitching: (enabled: boolean) => Promise<boolean>;
  clearBlockedServers: () => Promise<boolean>;
  getAppSnapshot: () => Promise<AppSnapshot>;
  setSelectedServerId: (serverId: string | null) => Promise<boolean>;
  getConnectionMode: () => Promise<ConnectionMode>;
  setConnectionMode: (mode: ConnectionMode) => Promise<boolean>;
  getTunCapabilityStatus: () => Promise<TunCapabilityStatus>;
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

  getUpdateStatus: () => Promise<UpdateStatus>;
  checkForUpdates: () => Promise<UpdateStatus>;
  installUpdate: () => Promise<boolean>;
}
