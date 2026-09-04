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
import {
  isSessionPhaseInFlight,
  isSessionPhaseSelectable,
  type AppSnapshot,
} from '@/shared/ipc';
import type { VlessConfig } from '@/shared/types';
import {
  findServerRow,
  isSameServerRow,
  type ServerRowIdentity,
} from '@/shared/serverRow';
import { useConnectionActions } from './useConnectionActions';

const EMPTY_SNAPSHOT: AppSnapshot = {
  servers: [],
  subscriptions: [],
  selectedServerId: null,
  connectionMode: 'proxy',
  session: {
    phase: 'idle',
    activeServerId: null,
    lastError: null,
    blockedServerIds: [],
  },
  health: {
    lastHealthState: 'idle',
    lastHealthFailureReason: null,
    lastHealthCheckAt: null,
    localProxyReachable: null,
  },
  process: {
    state: 'stopped',
    ready: false,
    xrayRunning: false,
    lastStartAt: null,
    lastReadyAt: null,
    lastReadinessCheckAt: null,
    localProxyReachable: null,
    lastFailureAt: null,
    lastFailureReason: null,
    lastReadinessError: null,
  },
  recovery: {
    recoveryInProgress: false,
    recoveryAttemptCount: 0,
    recoveryBlocked: false,
    lastRecoveryAt: null,
    lastRecoveryTrigger: null,
    lastRecoveryOutcome: null,
    lastRecoveryReason: null,
    lastFatalReason: null,
  },
  autoSwitchingEnabled: true,
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
  const pingRefreshInFlightRef = useRef(false);
  // Optimistic server selection that hasn't been confirmed by main yet.
  // Incoming snapshots (ping/traffic pushes, refreshes) may still carry the
  // old selectedServerId, so the pending value is overlaid until confirmed.
  const [pendingSelectionRow, setPendingSelectionRow] =
    useState<ServerRowIdentity | null>(null);
  const pendingSelectionRef = useRef<{
    row: ServerRowIdentity;
    version: number;
  } | null>(null);
  const selectVersionRef = useRef(0);
  const refreshSeqRef = useRef(0);

  const selectedServer =
    findServerRow(snapshot.servers, pendingSelectionRow) ??
    snapshot.servers.find(
      (server) => server.uuid === snapshot.selectedServerId,
    ) ??
    snapshot.servers.find(
      (server) => server.uuid === snapshot.session.activeServerId,
    ) ??
    null;
  const phase = snapshot.session.phase;
  // `switching` means the tunnel is being torn down or rebuilt — traffic is
  // not protected. Treat only a verified `connected` phase as connected.
  const isConnected = phase === 'connected';
  const isConnectionBusy = isSessionPhaseInFlight(phase);
  const connectionError = clientError ?? snapshot.session.lastError;

  const applySnapshot = useCallback((nextSnapshot: AppSnapshot) => {
    const pendingSelection = pendingSelectionRef.current;
    setSnapshot({
      ...nextSnapshot,
      selectedServerId: pendingSelection
        ? pendingSelection.row.uuid
        : nextSnapshot.selectedServerId,
    });
    if (!nextSnapshot.session.lastError) {
      setClientError(null);
    }
    if (!pendingSelection) {
      return;
    }
    const selectedId = nextSnapshot.selectedServerId;
    if (selectedId !== pendingSelection.row.uuid) {
      return;
    }
    const uuidOwner = nextSnapshot.servers.find(
      (server) => server.uuid === selectedId,
    );
    const pendingRow = findServerRow(
      nextSnapshot.servers,
      pendingSelection.row,
    );
    // Uuid collisions: the stored id may already equal the clicked uuid while
    // the uuid owner in the list is a different row. Keep the pending row
    // until the snapshot's uuid owner is the clicked card.
    if (
      pendingRow &&
      isSameServerRow(pendingRow, pendingSelection.row) &&
      uuidOwner &&
      isSameServerRow(uuidOwner, pendingSelection.row)
    ) {
      pendingSelectionRef.current = null;
      setPendingSelectionRow(null);
    }
  }, []);

  const refreshSnapshot = useCallback(async () => {
    const seq = ++refreshSeqRef.current;
    const nextSnapshot = await window.electronAPI.getAppSnapshot();
    if (seq !== refreshSeqRef.current) {
      // A newer refresh started while this one was in flight — drop the
      // stale result so it can't overwrite fresher state.
      return;
    }
    applySnapshot(nextSnapshot);
  }, [applySnapshot]);

  useEffect(() => {
    let disposed = false;
    void window.electronAPI
      .getAppSnapshot()
      .then((nextSnapshot) => {
        if (!disposed) applySnapshot(nextSnapshot);
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
        applySnapshot(nextSnapshot);
      },
    );

    return () => {
      disposed = true;
      removeSnapshotListener();
    };
  }, [applySnapshot]);

  const toggleConnection = useConnectionActions({
    selectedServer,
    isConnected,
    isConnectionBusy,
    setConnectionError: setClientError,
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
      // Allow picks while idle or after a failed connect. In-flight and
      // connected sessions keep the current server so the tunnel is not
      // retargeted from under a live operation.
      if (!isSessionPhaseSelectable(snapshot.session.phase)) {
        return;
      }
      const version = ++selectVersionRef.current;
      const row: ServerRowIdentity = {
        uuid: server.uuid,
        name: server.name,
        address: server.address,
        port: server.port,
        sni: server.sni,
      };
      pendingSelectionRef.current = { row, version };
      setPendingSelectionRow(row);
      let previousSelectedId: string | null = null;
      setSnapshot((current) => {
        previousSelectedId = current.selectedServerId;
        return { ...current, selectedServerId: server.uuid };
      });
      void window.electronAPI
        .setSelectedServerId(server.uuid)
        .then(() => refreshSnapshot())
        .catch((error) => {
          console.error('Failed to persist selected server', error);
          if (pendingSelectionRef.current?.version === version) {
            // Roll back the optimistic selection unless a newer click
            // already superseded it.
            pendingSelectionRef.current = null;
            setPendingSelectionRow(null);
            setSnapshot((current) => ({
              ...current,
              selectedServerId: previousSelectedId,
            }));
          }
          setClientError('Failed to persist selected server');
        });
    },
    [refreshSnapshot, snapshot.session.phase],
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
    throw new Error(
      'useAppSnapshotContext must be used within AppSnapshotProvider',
    );
  }
  return value;
}

export function useAppSnapshot(): AppSnapshot {
  return useAppSnapshotContext().snapshot;
}

export function useServers() {
  const {
    snapshot,
    selectedServer,
    selectServer,
    isRefreshingPings,
    pingAllServers,
  } = useAppSnapshotContext();
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
