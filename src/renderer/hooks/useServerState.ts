import { useAppSnapshotContext } from './useAppSnapshot';

/**
 * Compatibility facade for components/tests that have not migrated to
 * AppSnapshot selectors yet.
 */
export function useServerState() {
  const {
    snapshot,
    selectedServer,
    isConnected,
    isConnectionBusy,
    connectionError,
    isRefreshingPings,
    selectServer,
    toggleConnection,
    pingAllServers,
  } = useAppSnapshotContext();

  return {
    servers: snapshot.servers,
    subscriptions: snapshot.subscriptions,
    selectedServer,
    isConnected,
    connectionError,
    isConnectionBusy,
    isRefreshingPings,
    trafficSnapshot: snapshot.traffic,
    setSelectedServer: selectServer,
    toggleConnection,
    pingAllServers,
  };
}
