import { vi } from 'vitest';
import type { IElectronAPI } from '../renderer/preload';
import type {
  AddSubscriptionPayload,
  AddSubscriptionResult,
  ConnectionMonitorEvent,
  ConnectionMonitorStatus,
  ConnectResult,
  DisconnectResult,
  SaveManualLinksResult,
} from '../shared/ipc';
import type { ConnectionMode, PerformanceSettings, Subscription, VlessConfig } from '../shared/types';
import { makeMonitorStatus } from './factories';

type ListenerMap = {
  updateServers: Set<(servers: VlessConfig[]) => void>;
  updateSubscriptions: Set<(subscriptions: Subscription[]) => void>;
  connectionStatus: Set<(status: boolean) => void>;
  connectionBusy: Set<(busy: boolean) => void>;
  connectionError: Set<(error: string) => void>;
  connectionMonitorEvent: Set<(event: ConnectionMonitorEvent) => void>;
};

export interface ElectronApiMock extends IElectronAPI {
  emitUpdateServers: (servers: VlessConfig[]) => void;
  emitUpdateSubscriptions: (subscriptions: Subscription[]) => void;
  emitConnectionStatus: (status: boolean) => void;
  emitConnectionBusy: (busy: boolean) => void;
  emitConnectionError: (error: string) => void;
  emitConnectionMonitorEvent: (event: ConnectionMonitorEvent) => void;
}

function createListenerRegistration<T>(listeners: Set<(value: T) => void>) {
  return vi.fn((callback: (value: T) => void) => {
    listeners.add(callback);
    return () => {
      listeners.delete(callback);
    };
  });
}

export function createElectronApiMock(overrides: Partial<IElectronAPI> = {}): ElectronApiMock {
  const listeners: ListenerMap = {
    updateServers: new Set(),
    updateSubscriptions: new Set(),
    connectionStatus: new Set(),
    connectionBusy: new Set(),
    connectionError: new Set(),
    connectionMonitorEvent: new Set(),
  };

  const api: ElectronApiMock = {
    connect: vi.fn(async (_server: VlessConfig): Promise<ConnectResult> => ({ ok: true })),
    disconnect: vi.fn(async (): Promise<DisconnectResult> => ({ ok: true })),

    // Subscriptions CRUD
    getSubscriptions: vi.fn(async (): Promise<Subscription[]> => []),
    addSubscription: vi.fn(async (_payload: AddSubscriptionPayload): Promise<AddSubscriptionResult & { subscriptionId: string }> => ({
      ok: true,
      configCount: 0,
      subscriptionId: 'mock-id',
    })),
    updateSubscription: vi.fn(async () => true),
    deleteSubscription: vi.fn(async () => true),
    refreshSubscriptions: vi.fn(async () => ({ ok: true, configCount: 0 })),

    // Manual links
    getManualLinks: vi.fn(async () => ''),
    saveManualLinks: vi.fn(async (): Promise<SaveManualLinksResult> => ({ ok: true, configCount: 0 })),

    // Events
    onUpdateServers: createListenerRegistration(listeners.updateServers),
    onUpdateSubscriptions: createListenerRegistration(listeners.updateSubscriptions),
    onConnectionStatus: createListenerRegistration(listeners.connectionStatus),
    onConnectionBusy: createListenerRegistration(listeners.connectionBusy),
    onConnectionError: createListenerRegistration(listeners.connectionError),
    onConnectionMonitorEvent: createListenerRegistration(listeners.connectionMonitorEvent),

    getConnectionMonitorStatus: vi.fn(async (): Promise<ConnectionMonitorStatus> => makeMonitorStatus()),
    setAutoSwitching: vi.fn(async (_enabled: boolean) => true),
    clearBlockedServers: vi.fn(async () => true),
    getServers: vi.fn(async () => []),
    getSelectedServerId: vi.fn(async () => null),
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
    getConnectionStatus: vi.fn(async () => false),
    getConnectionBusy: vi.fn(async () => false),
    getLogs: vi.fn(async () => ''),
    openLogFolder: vi.fn(async () => true),
    openExternalUrl: vi.fn(async (_url: string) => true),
    importMobileWhiteListSubscription: vi.fn(async () => ({ ok: true, configCount: 1 })),
    getAppVersion: vi.fn(async () => '0.0.0-test'),
    pingServer: vi.fn(async (_server: VlessConfig) => ({ uuid: _server.uuid, latency: null })),
    pingAllServers: vi.fn(async (_force?: boolean) => []),
    getPerformanceSettings: vi.fn(async (): Promise<PerformanceSettings> => ({
      muxEnabled: true,
      muxConcurrency: 8,
      xudpConcurrency: 16,
      xudpProxyUDP443: 'reject',
      tcpFastOpen: true,
      sniffingRouteOnly: true,
      logLevel: 'warning',
      fingerprint: 'chrome',
      blockAds: true,
      blockBittorrent: true,
      domainStrategy: 'IPIfNonMatch',
    })),
    setPerformanceSettings: vi.fn(async (_settings: PerformanceSettings) => true),

    emitUpdateServers: (servers: VlessConfig[]) => {
      listeners.updateServers.forEach((listener) => listener(servers));
    },
    emitUpdateSubscriptions: (subs: Subscription[]) => {
      listeners.updateSubscriptions.forEach((listener) => listener(subs));
    },
    emitConnectionStatus: (status: boolean) => {
      listeners.connectionStatus.forEach((listener) => listener(status));
    },
    emitConnectionBusy: (busy: boolean) => {
      listeners.connectionBusy.forEach((listener) => listener(busy));
    },
    emitConnectionError: (error: string) => {
      listeners.connectionError.forEach((listener) => listener(error));
    },
    emitConnectionMonitorEvent: (event: ConnectionMonitorEvent) => {
      listeners.connectionMonitorEvent.forEach((listener) => listener(event));
    },
  };

  return Object.assign(api, overrides);
}

export function installElectronApiMock(api: IElectronAPI): void {
  window.electronAPI = api;
}
