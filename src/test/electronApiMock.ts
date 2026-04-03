import { vi } from 'vitest';
import type { IElectronAPI } from '../renderer/preload';
import type { ConnectionMonitorEvent, ConnectionMonitorStatus, ConnectResult, DisconnectResult, SaveSubscriptionPayload } from '../shared/ipc';
import type { ConnectionMode, VlessConfig } from '../shared/types';
import { makeMonitorStatus } from './factories';

type ListenerMap = {
  updateServers: Set<(servers: VlessConfig[]) => void>;
  connectionStatus: Set<(status: boolean) => void>;
  connectionBusy: Set<(busy: boolean) => void>;
  connectionError: Set<(error: string) => void>;
  connectionMonitorEvent: Set<(event: ConnectionMonitorEvent) => void>;
  manualLinksUpdated: Set<(manualLinks: string) => void>;
};

export interface ElectronApiMock extends IElectronAPI {
  emitUpdateServers: (servers: VlessConfig[]) => void;
  emitConnectionStatus: (status: boolean) => void;
  emitConnectionBusy: (busy: boolean) => void;
  emitConnectionError: (error: string) => void;
  emitConnectionMonitorEvent: (event: ConnectionMonitorEvent) => void;
  emitManualLinksUpdated: (manualLinks: string) => void;
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
    connectionStatus: new Set(),
    connectionBusy: new Set(),
    connectionError: new Set(),
    connectionMonitorEvent: new Set(),
    manualLinksUpdated: new Set(),
  };

  const api: ElectronApiMock = {
    connect: vi.fn(async (_server: VlessConfig): Promise<ConnectResult> => ({ ok: true })),
    disconnect: vi.fn(async (): Promise<DisconnectResult> => ({ ok: true })),
    saveSubscription: vi.fn(async (_payload: SaveSubscriptionPayload) => true),
    onUpdateServers: createListenerRegistration(listeners.updateServers),
    onManualLinksUpdated: createListenerRegistration(listeners.manualLinksUpdated),
    onConnectionStatus: createListenerRegistration(listeners.connectionStatus),
    onConnectionBusy: createListenerRegistration(listeners.connectionBusy),
    onConnectionError: createListenerRegistration(listeners.connectionError),
    onConnectionMonitorEvent: createListenerRegistration(listeners.connectionMonitorEvent),
    getConnectionMonitorStatus: vi.fn(async (): Promise<ConnectionMonitorStatus> => makeMonitorStatus()),
    setAutoSwitching: vi.fn(async (_enabled: boolean) => true),
    clearBlockedServers: vi.fn(async () => true),
    getServers: vi.fn(async () => []),
    getSubscriptionUrl: vi.fn(async () => ''),
    getManualLinks: vi.fn(async () => ''),
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
    emitUpdateServers: (servers: VlessConfig[]) => {
      listeners.updateServers.forEach((listener) => listener(servers));
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
    emitManualLinksUpdated: (manualLinks: string) => {
      listeners.manualLinksUpdated.forEach((listener) => listener(manualLinks));
    },
  };

  return Object.assign(api, overrides);
}

export function installElectronApiMock(api: IElectronAPI): void {
  window.electronAPI = api;
}
