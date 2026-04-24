import { useState, useEffect, useCallback, useRef } from 'react';
import { Subscription, VlessConfig } from '@/shared/types';
import type { TrafficSnapshot } from '@/shared/ipc';
import { hasMissingPingData, reconcileSelection } from './useServerStateUtils';

export function useServerState() {
  const [servers, setServers] = useState<VlessConfig[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [selectedServer, setSelectedServer] = useState<VlessConfig | null>(
    null,
  );
  const [isConnected, setIsConnected] = useState(false);
  const [isConnectionBusy, setIsConnectionBusy] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [trafficSnapshot, setTrafficSnapshot] =
    useState<TrafficSnapshot | null>(null);
  const toggleInFlightRef = useRef(false);
  const selectedServerRef = useRef<VlessConfig | null>(null);
  const connectedRef = useRef(false);
  const busyRef = useRef(false);
  const initialLoadDoneRef = useRef(false);

  const updateSelectedServerState = useCallback(
    (server: VlessConfig | null) => {
      selectedServerRef.current = server;
      setSelectedServer(server);
    },
    [],
  );

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
      const [
        initialServers,
        initialSubscriptions,
        savedServerId,
        connectionStatus,
        initialBusy,
      ] = await Promise.all([
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
        const savedServer = initialServers.find(
          (s) => s.uuid === savedServerId,
        );
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

    void loadInitialState().catch((error) => {
      console.error('Failed to load initial renderer state', error);
    });

    const handleUpdateServers = (newServers: VlessConfig[]) => {
      setServers(newServers);

      const currentSelected = selectedServerRef.current;
      if (currentSelected) {
        // Try to find the exact currently selected server in the new list
        const updated = newServers.find(
          (server) => server.uuid === currentSelected.uuid,
        );

        if (updated) {
          updateSelectedServerState(updated);
        } else if (!initialLoadDoneRef.current) {
          // Initial load hasn't finished selecting; don't override yet
        } else if (connectedRef.current || busyRef.current) {
          // We are connected/connecting, but our selected server disappeared.
          // Fall back to what the monitor thinks is running, or what we saved last, or newServers[0]
          void (async () => {
            try {
              const monitorStatus =
                await window.electronAPI.getConnectionMonitorStatus();
              const savedId = await window.electronAPI.getSelectedServerId();
              if (disposed) return;

              if (savedId) {
                const fromSaved = newServers.find(
                  (server) => server.uuid === savedId,
                );
                if (fromSaved) {
                  updateSelectedServerState(fromSaved);
                  return;
                }
              }

              if (
                (monitorStatus.isConnected || busyRef.current) &&
                monitorStatus.currentServer
              ) {
                const fromList =
                  newServers.find(
                    (server) =>
                      server.uuid === monitorStatus.currentServer?.uuid,
                  ) ?? monitorStatus.currentServer;
                updateSelectedServerState(fromList);
              } else {
                updateSelectedServerState(newServers[0] ?? null);
              }
            } catch (error) {
              console.error(
                'Failed to reconcile active server after refresh',
                error,
              );
              if (!disposed) {
                updateSelectedServerState(newServers[0] ?? null);
              }
            }
          })();
        } else {
          // Not connected, server disappeared -> reconcile
          void reconcileSelection(
            newServers,
            currentSelected,
            window.electronAPI,
          )
            .then((nextServer) => {
              if (!disposed) {
                updateSelectedServerState(nextServer);
              }
            })
            .catch(() => {
              updateSelectedServerState(newServers[0] ?? null);
            });
        }
      } else if (initialLoadDoneRef.current) {
        // No current selection, try to reconcile from saved
        void reconcileSelection(newServers, null, window.electronAPI)
          .then((nextServer) => {
            if (!disposed) {
              updateSelectedServerState(nextServer);
            }
          })
          .catch(() => {
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
      if (status) {
        setConnectionError(null);
      } else {
        setTrafficSnapshot(null);
        // Ensure the renderer doesn't stay stuck in a "connecting" spinner when
        // a session drops; the main process will re-emit busy=true as soon as
        // the next operation begins.
        if (busyRef.current) {
          busyRef.current = false;
          setIsConnectionBusy(false);
        }
      }
    };

    const handleConnectionBusy = (busy: boolean) => {
      setIsConnectionBusy(busy);
      busyRef.current = busy;
    };

    const handleConnectionError = (error: string) => {
      setConnectionError(error);
    };

    const handleConnectionMonitorEvent = (
      event: import('@/shared/ipc').ConnectionMonitorEvent,
    ) => {
      if (event.type === 'connected' && event.server) {
        setServers((currentServers) => {
          let targetServer = currentServers.find(
            (s) => s.uuid === event.server!.uuid,
          );
          if (!targetServer) {
            // Fallback to fuzzy match by address, port, and name
            const fuzzy = currentServers.find(
              (s) =>
                s.address === event.server!.address &&
                s.port === event.server!.port &&
                s.name === event.server!.name,
            );
            if (fuzzy) {
              targetServer = fuzzy;
            } else {
              // Last resort: just IP and Port
              const fuzzyIp = currentServers.find(
                (s) =>
                  s.address === event.server!.address &&
                  s.port === event.server!.port,
              );
              targetServer = fuzzyIp ?? event.server!;
            }
          }

          updateSelectedServerState(targetServer);
          // Always persist the actual selected server ID immediately,
          // to ensure it isn't lost on the next render cycle or app restart.
          window.electronAPI
            .setSelectedServerId(targetServer.uuid)
            .catch(console.error);

          return currentServers;
        });
      }
    };

    const handleTrafficStats = (snapshot: TrafficSnapshot | null) => {
      setTrafficSnapshot(snapshot);
    };

    const removeUpdateServers =
      window.electronAPI.onUpdateServers(handleUpdateServers);
    const removeUpdateSubscriptions = window.electronAPI.onUpdateSubscriptions(
      handleUpdateSubscriptions,
    );
    const removeConnectionStatus = window.electronAPI.onConnectionStatus(
      handleConnectionStatus,
    );
    const removeConnectionBusy =
      window.electronAPI.onConnectionBusy(handleConnectionBusy);
    const removeConnectionError = window.electronAPI.onConnectionError(
      handleConnectionError,
    );
    const removeConnectionMonitorEvent =
      window.electronAPI.onConnectionMonitorEvent(handleConnectionMonitorEvent);
    const removeTrafficStats =
      window.electronAPI.onTrafficStats?.(handleTrafficStats);

    // Hydrate the existing traffic snapshot on first mount so we don't wait for
    // the next poll tick to start drawing the session counters.
    if (window.electronAPI.getTrafficStats) {
      void window.electronAPI
        .getTrafficStats()
        .then((snapshot) => {
          if (!disposed) setTrafficSnapshot(snapshot);
        })
        .catch(() => undefined);
    }

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
      removeConnectionMonitorEvent();
      removeTrafficStats?.();
    };
  }, [updateSelectedServerState]);

  const toggleConnection = useCallback(async () => {
    if (!selectedServer || isConnectionBusy || toggleInFlightRef.current)
      return;
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
      setConnectionError(
        error instanceof Error ? error.message : 'Connection operation failed',
      );
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

  const selectServer = useCallback(
    (server: VlessConfig) => {
      updateSelectedServerState(server);
      void window.electronAPI
        .setSelectedServerId(server.uuid)
        .catch((error) => {
          console.error('Failed to persist selected server', error);
        });
    },
    [updateSelectedServerState],
  );

  return {
    servers,
    subscriptions,
    selectedServer,
    isConnected,
    connectionError,
    isConnectionBusy,
    trafficSnapshot,
    setSelectedServer: selectServer,
    toggleConnection,
    pingAllServers,
  };
}
