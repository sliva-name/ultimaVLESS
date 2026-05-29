import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { AppSnapshot } from '@/shared/ipc';
import type { VlessConfig } from '@/shared/types';
import { useConnectionActions } from './useConnectionActions';

const EMPTY_SNAPSHOT: AppSnapshot = {
  servers: [],
  subscriptions: [],
  selectedServerId: null,
  connectionMode: 'proxy',
  session: {
    status: 'idle',
    busy: false,
    activeServerId: null,
    lastError: null,
    blockedServerIds: [],
  },
  traffic: null,
};

interface AppSnapshotContextValue {
  snapshot: AppSnapshot;
  selectedServer: VlessConfig | null;
  isConnected: boolean;
  isConnectionBusy: boolean;
  connectionError: string | null;
  isRefreshingPings: boolean;
  selectServer: (server: VlessConfig) => void;
  toggleConnection: () => Promise<void>;
  pingAllServers: () => Promise<void>;
  refreshSnapshot: () => Promise<void>;
}

const AppSnapshotContext = createContext<AppSnapshotContextValue | null>(null);

export function AppSnapshotProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<AppSnapshot>(EMPTY_SNAPSHOT);
  const [clientError, setClientError] = useState<string | null>(null);
  const [isRefreshingPings, setIsRefreshingPings] = useState(false);
  const toggleInFlightRef = useRef(false);
  const pingRefreshInFlightRef = useRef(false);

  const selectedServer =
    snapshot.servers.find(
      (server) => server.uuid === snapshot.selectedServerId,
    ) ??
    snapshot.servers.find(
      (server) => server.uuid === snapshot.session.activeServerId,
    ) ??
    null;
  const isConnected =
    snapshot.session.status === 'connected' ||
    snapshot.session.status === 'switching';
  const isConnectionBusy = snapshot.session.busy;
  const connectionError = clientError ?? snapshot.session.lastError;

  const refreshSnapshot = useCallback(async () => {
    const nextSnapshot = await window.electronAPI.getAppSnapshot();
    setSnapshot(nextSnapshot);
    if (!nextSnapshot.session.lastError) {
      setClientError(null);
    }
  }, []);

  useEffect(() => {
    let disposed = false;
    void window.electronAPI
      .getAppSnapshot()
      .then((nextSnapshot) => {
        if (!disposed) setSnapshot(nextSnapshot);
      })
      .catch((error) => {
        console.error('Failed to load app snapshot', error);
        if (!disposed) {
          setClientError(
            error instanceof Error
              ? `Failed to load saved state: ${error.message}`
              : 'Failed to load saved state',
          );
        }
      });

    const removeSnapshotListener = window.electronAPI.onAppSnapshotChanged(
      (nextSnapshot) => {
        setSnapshot(nextSnapshot);
        if (!nextSnapshot.session.lastError) {
          setClientError(null);
        }
      },
    );

    return () => {
      disposed = true;
      removeSnapshotListener();
    };
  }, []);

  const toggleConnection = useConnectionActions({
    selectedServer,
    isConnected,
    isConnectionBusy,
    toggleInFlightRef,
    setConnectionError: setClientError,
    refreshSnapshot,
  });

  const pingAllServers = useCallback(async () => {
    if (isConnected || isConnectionBusy || pingRefreshInFlightRef.current) {
      return;
    }
    pingRefreshInFlightRef.current = true;
    setIsRefreshingPings(true);
    try {
      await window.electronAPI.pingAllServers(true);
      await refreshSnapshot();
    } catch (error) {
      console.error('Failed to ping all servers', error);
      setClientError('Failed to refresh server latency');
    } finally {
      pingRefreshInFlightRef.current = false;
      setIsRefreshingPings(false);
    }
  }, [isConnected, isConnectionBusy, refreshSnapshot]);

  const selectServer = useCallback(
    (server: VlessConfig) => {
      setSnapshot((current) => ({
        ...current,
        selectedServerId: server.uuid,
      }));
      void window.electronAPI
        .setSelectedServerId(server.uuid)
        .then(refreshSnapshot)
        .catch((error) => {
          console.error('Failed to persist selected server', error);
          setClientError('Failed to persist selected server');
        });
    },
    [refreshSnapshot],
  );

  const value = useMemo<AppSnapshotContextValue>(
    () => ({
      snapshot,
      selectedServer,
      isConnected,
      isConnectionBusy,
      connectionError,
      isRefreshingPings,
      selectServer,
      toggleConnection,
      pingAllServers,
      refreshSnapshot,
    }),
    [
      snapshot,
      selectedServer,
      isConnected,
      isConnectionBusy,
      connectionError,
      isRefreshingPings,
      selectServer,
      toggleConnection,
      pingAllServers,
      refreshSnapshot,
    ],
  );

  return (
    <AppSnapshotContext.Provider value={value}>
      {children}
    </AppSnapshotContext.Provider>
  );
}

export function useAppSnapshotContext(): AppSnapshotContextValue {
  const value = useContext(AppSnapshotContext);
  if (!value) {
    throw new Error('useAppSnapshotContext must be used within AppSnapshotProvider');
  }
  return value;
}

export function useAppSnapshot(): AppSnapshot {
  return useAppSnapshotContext().snapshot;
}

export function useServers() {
  const { snapshot, selectedServer, selectServer, isRefreshingPings, pingAllServers } =
    useAppSnapshotContext();
  return {
    servers: snapshot.servers,
    subscriptions: snapshot.subscriptions,
    selectedServer,
    isRefreshingPings,
    selectServer,
    pingAllServers,
  };
}

export function useSession() {
  const {
    snapshot,
    isConnected,
    isConnectionBusy,
    connectionError,
    toggleConnection,
  } = useAppSnapshotContext();
  return {
    session: snapshot.session,
    isConnected,
    isConnectionBusy,
    connectionError,
    trafficSnapshot: snapshot.traffic,
    toggleConnection,
  };
}
