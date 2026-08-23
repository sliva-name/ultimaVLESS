import { vi } from 'vitest';
import type { IElectronAPI } from '@/shared/contracts/preloadApi';
import type {
  AddSubscriptionPayload,
  AddSubscriptionResult,
  AppSnapshot,
  ConnectionMonitorEvent,
  ConnectResult,
  DisconnectResult,
  SaveManualLinksResult,
  UpdateStatus,
} from '@/shared/ipc';
import type {
  ConnectionMode,
  PerformanceSettings,
  VlessConfig,
} from '@/shared/types';
import { makeAppSnapshot } from './factories';

type ListenerMap = {
  appSnapshotChanged: Set<(snapshot: AppSnapshot) => void>;
  connectionMonitorEvent: Set<(event: ConnectionMonitorEvent) => void>;
  updateStatus: Set<(status: UpdateStatus) => void>;
};

export interface ElectronApiMock extends IElectronAPI {
  emitAppSnapshotChanged: (snapshot: AppSnapshot) => void;
  emitConnectionMonitorEvent: (event: ConnectionMonitorEvent) => void;
  emitUpdateStatus: (status: UpdateStatus) => void;
}

function createListenerRegistration<T>(listeners: Set<(value: T) => void>) {
  return vi.fn((callback: (value: T) => void) => {
    listeners.add(callback);
    return () => {
      listeners.delete(callback);
    };
  });
}

export function createElectronApiMock(
  overrides: Partial<IElectronAPI> = {},
): ElectronApiMock {
  const listeners: ListenerMap = {
    appSnapshotChanged: new Set(),
    connectionMonitorEvent: new Set(),
    updateStatus: new Set(),
  };

  const api: ElectronApiMock = {
    connect: vi.fn(async (_serverId: string): Promise<ConnectResult> => ({
      ok: true,
    })),
    disconnect: vi.fn(async (): Promise<DisconnectResult> => ({ ok: true })),

    // Subscriptions CRUD
    addSubscription: vi.fn(
      async (
        _payload: AddSubscriptionPayload,
      ): Promise<AddSubscriptionResult & { subscriptionId: string }> => ({
        ok: true,
        configCount: 0,
        subscriptionId: 'mock-id',
      }),
    ),
    updateSubscription: vi.fn(async () => true),
    deleteSubscription: vi.fn(async () => true),
    refreshSubscriptions: vi.fn(async () => ({ ok: true, configCount: 0 })),

    // Manual links
    getManualLinks: vi.fn(async () => ''),
    saveManualLinks: vi.fn(
      async (): Promise<SaveManualLinksResult> => ({
        ok: true,
        configCount: 0,
      }),
    ),

    // Events
    onAppSnapshotChanged: createListenerRegistration(
      listeners.appSnapshotChanged,
    ),
    onConnectionMonitorEvent: createListenerRegistration(
      listeners.connectionMonitorEvent,
    ),
    onUpdateStatus: createListenerRegistration(listeners.updateStatus),

    setAutoSwitching: vi.fn(async (_enabled: boolean) => true),
    clearBlockedServers: vi.fn(async () => true),
    getAppSnapshot: vi.fn(async (): Promise<AppSnapshot> => {
      const connectionMode = await api.getConnectionMode();
      return makeAppSnapshot({ connectionMode });
    }),
    setSelectedServerId: vi.fn(async (_serverId: string | null) => true),
    getConnectionMode: vi.fn(async (): Promise<ConnectionMode> => 'proxy'),
    setConnectionMode: vi.fn(async (_mode: ConnectionMode) => true),
    getTunCapabilityStatus: vi.fn(async () => ({
      platform: 'win32',
      supported: true,
      hasPrivileges: true,
      privilegeHint: null,
      unsupportedReason: null,
      routeMode: 'windows-static-routes',
      degradedReason: null,
    })),
    getLogs: vi.fn(async () => ''),
    openLogFolder: vi.fn(async () => true),
    openExternalUrl: vi.fn(async (_url: string) => true),
    importMobileWhiteListSubscription: vi.fn(async () => ({
      ok: true,
      configCount: 1,
    })),
    getAppVersion: vi.fn(async () => '0.0.0-test'),
    pingServer: vi.fn(async (_server: VlessConfig) => ({
      uuid: _server.uuid,
      latency: null,
    })),
    pingAllServers: vi.fn(async (_force?: boolean) => []),
    getPerformanceSettings: vi.fn(
      async (): Promise<PerformanceSettings> => ({
        muxEnabled: false,
        muxConcurrency: 8,
        xudpConcurrency: 16,
        xudpProxyUDP443: 'reject',
        xhttpMaxConnections: 3,
        remoteDnsPreset: 'cloudflare',
        remoteDnsServers: ['1.1.1.1', '1.0.0.1'],
        tcpFastOpen: true,
        sniffingRouteOnly: true,
        logLevel: 'warning',
        fingerprint: 'chrome',
        blockAds: false,
        blockBittorrent: false,
        domainStrategy: 'AsIs',
        windowsTunRouting: 'xray',
        bypassDomains: [],
        bypassIps: [],
      }),
    ),
    setPerformanceSettings: vi.fn(
      async (_settings: PerformanceSettings) => true,
    ),

    getUiLanguage: vi.fn(async (): Promise<'en' | 'ru'> => 'en'),
    setUiLanguage: vi.fn(async (_language: 'en' | 'ru') => true),
    getUpdateStatus: vi.fn(
      async (): Promise<UpdateStatus> => ({
        stage: 'disabled',
        version: null,
        releaseNotes: null,
        percent: 0,
        bytesPerSecond: 0,
        error: null,
        updatedAt: 0,
      }),
    ),
    checkForUpdates: vi.fn(
      async (): Promise<UpdateStatus> => ({
        stage: 'disabled',
        version: null,
        releaseNotes: null,
        percent: 0,
        bytesPerSecond: 0,
        error: null,
        updatedAt: 0,
      }),
    ),
    installUpdate: vi.fn(async () => true),

    emitAppSnapshotChanged: (snapshot: AppSnapshot) => {
      listeners.appSnapshotChanged.forEach((listener) => listener(snapshot));
    },
    emitConnectionMonitorEvent: (event: ConnectionMonitorEvent) => {
      listeners.connectionMonitorEvent.forEach((listener) => listener(event));
    },
    emitUpdateStatus: (status: UpdateStatus) => {
      listeners.updateStatus.forEach((listener) => listener(status));
    },
  };

  return Object.assign(api, overrides);
}

export function installElectronApiMock(api: IElectronAPI): void {
  window.electronAPI = api;
}
