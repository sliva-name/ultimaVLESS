import { useState, useEffect, useCallback, useRef } from 'react';
import { Subscription, VlessConfig } from '../../shared/types';
import { hasMissingPingData, reconcileSelection } from './useServerStateUtils';

export function useServerState() {
  const [servers, setServers] = useState<VlessConfig[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [selectedServer, setSelectedServer] = useState<VlessConfig | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnectionBusy, setIsConnectionBusy] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const toggleInFlightRef = useRef(false);
  const selectedServerRef = useRef<VlessConfig | null>(null);
  const connectedRef = useRef(false);
  const busyRef = useRef(false);
  const initialLoadDoneRef = useRef(false);

  const updateSelectedServerState = useCallback((server: VlessConfig | null) => {
    selectedServerRef.current = server;
    setSelectedServer(server);
  }, []);

  useEffect(() => {
    let pingTimer: number | null = null;
    let disposed = false;
    const schedulePingAll = (force: boolean) => {
      if (disposed) return;
      if (connectedRef.current || busyRef.current) return;
      if (pingTimer !== null) {
        window.clearTimeout(pingTimer);
      }
      pingTimer = window.setTimeout(() => {
        if (disposed) return;
        void (async () => {
          const [connectedNow, busyNow] = await Promise.all([
            window.electronAPI.getConnectionStatus(),
            window.electronAPI.getConnectionBusy(),
          ]);
          if (connectedNow || busyNow) return;
          await window.electronAPI.pingAllServers(force);
        })().catch((error) => {
          console.error('Failed to ping servers', error);
        });
        pingTimer = null;
      }, 1200);
    };

    const loadInitialState = async () => {
      const [initialServers, initialSubscriptions, savedServerId, connectionStatus, initialBusy] = await Promise.all([
        window.electronAPI.getServers(),
        window.electronAPI.getSubscriptions(),
        window.electronAPI.getSelectedServerId(),
        window.electronAPI.getConnectionStatus(),
        window.electronAPI.getConnectionBusy(),
      ]);
      if (disposed) return;

      setServers(initialServers);
      setSubscriptions(initialSubscriptions);
      setIsConnected(connectionStatus);
      connectedRef.current = connectionStatus;
      setIsConnectionBusy(initialBusy);
      busyRef.current = initialBusy;

      if (savedServerId && initialServers.length > 0) {
        const savedServer = initialServers.find(s => s.uuid === savedServerId);
        updateSelectedServerState(savedServer || initialServers[0]);
      } else if (initialServers.length > 0) {
        updateSelectedServerState(initialServers[0]);
      }

      initialLoadDoneRef.current = true;

      if (!connectionStatus && !initialBusy && initialServers.length > 0) {
        if (hasMissingPingData(initialServers)) {
          schedulePingAll(true);
        }
      }
    };

    void loadInitialState();

    const handleUpdateServers = (newServers: VlessConfig[]) => {
      setServers(newServers);

      const currentSelected = selectedServerRef.current;
      if (currentSelected) {
        const updated = newServers.find((server) => server.uuid === currentSelected.uuid);
        if (updated) {
          updateSelectedServerState(updated);
        } else if (!initialLoadDoneRef.current) {
          // Initial load hasn't finished selecting; don't override yet
        } else if (connectedRef.current) {
          void (async () => {
            try {
              const monitorStatus = await window.electronAPI.getConnectionMonitorStatus();
              if (disposed) return;
              if (monitorStatus.isConnected && monitorStatus.currentServer) {
                const fromList =
                  newServers.find((server) => server.uuid === monitorStatus.currentServer?.uuid) ??
                  monitorStatus.currentServer;
                updateSelectedServerState(fromList);
              }
            } catch (error) {
              console.error('Failed to reconcile active server after refresh', error);
            }
          })();
        } else {
          void reconcileSelection(newServers, currentSelected, window.electronAPI).then((nextServer) => {
            if (!disposed) {
              updateSelectedServerState(nextServer);
            }
          }).catch(() => {
            updateSelectedServerState(newServers[0] ?? null);
          });
        }
      } else if (initialLoadDoneRef.current) {
        void reconcileSelection(newServers, null, window.electronAPI).then((nextServer) => {
          if (!disposed) {
            updateSelectedServerState(nextServer);
          }
        }).catch(() => {
          updateSelectedServerState(newServers[0] ?? null);
        });
      }

      if (newServers.length > 0 && !connectedRef.current && !busyRef.current) {
        if (hasMissingPingData(newServers)) {
          schedulePingAll(false);
        }
      }
    };

    const handleUpdateSubscriptions = (newSubscriptions: Subscription[]) => {
      setSubscriptions(newSubscriptions);
    };

    const handleConnectionStatus = (status: boolean) => {
      setIsConnected(status);
      connectedRef.current = status;
      if (status) setConnectionError(null);
    };

    const handleConnectionBusy = (busy: boolean) => {
      setIsConnectionBusy(busy);
      busyRef.current = busy;
    };

    const handleConnectionError = (error: string) => {
      setConnectionError(error);
    };

    const removeUpdateServers = window.electronAPI.onUpdateServers(handleUpdateServers);
    const removeUpdateSubscriptions = window.electronAPI.onUpdateSubscriptions(handleUpdateSubscriptions);
    const removeConnectionStatus = window.electronAPI.onConnectionStatus(handleConnectionStatus);
    const removeConnectionBusy = window.electronAPI.onConnectionBusy(handleConnectionBusy);
    const removeConnectionError = window.electronAPI.onConnectionError(handleConnectionError);

    return () => {
      disposed = true;
      if (pingTimer !== null) {
        window.clearTimeout(pingTimer);
      }
      removeUpdateServers();
      removeUpdateSubscriptions();
      removeConnectionStatus();
      removeConnectionBusy();
      removeConnectionError();
    };
  }, [updateSelectedServerState]);

  const toggleConnection = useCallback(async () => {
    if (!selectedServer || isConnectionBusy || toggleInFlightRef.current) return;
    toggleInFlightRef.current = true;
    setIsConnectionBusy(true);
    try {
      if (isConnected) {
        const result = await window.electronAPI.disconnect();
        if (!result.ok) {
          setConnectionError('Failed to disconnect cleanly');
          return;
        }
        setConnectionError(null);
      } else {
        setConnectionError(null);
        const result = await window.electronAPI.connect(selectedServer);
        if (!result.ok && result.error) {
          setConnectionError(result.error);
        }
      }
    } catch (error) {
      console.error('Connection toggle failed', error);
      setConnectionError(error instanceof Error ? error.message : 'Connection operation failed');
    } finally {
      toggleInFlightRef.current = false;
      try {
        const busy = await window.electronAPI.getConnectionBusy();
        setIsConnectionBusy(busy);
      } catch {
        setIsConnectionBusy(false);
      }
    }
  }, [selectedServer, isConnected, isConnectionBusy]);

  const pingAllServers = useCallback(async () => {
    if (connectedRef.current || busyRef.current) return;
    try {
      await window.electronAPI.pingAllServers(true);
    } catch (error) {
      console.error('Failed to ping all servers', error);
    }
  }, []);

  const selectServer = useCallback((server: VlessConfig) => {
    updateSelectedServerState(server);
    void window.electronAPI.setSelectedServerId(server.uuid).catch((error) => {
      console.error('Failed to persist selected server', error);
    });
  }, [updateSelectedServerState]);

  return {
    servers,
    subscriptions,
    selectedServer,
    isConnected,
    connectionError,
    isConnectionBusy,
    setSelectedServer: selectServer,
    toggleConnection,
    pingAllServers,
  };
}
