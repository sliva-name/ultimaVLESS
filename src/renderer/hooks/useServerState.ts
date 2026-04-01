import { useState, useEffect, useCallback, useRef } from 'react';
import { VlessConfig } from '../../shared/types';
import { SaveSubscriptionPayload } from '../../shared/ipc';

export function useServerState() {
  type SaveSubscriptionResult = { ok: true } | { ok: false; error: string };
  const [servers, setServers] = useState<VlessConfig[]>([]);
  const [selectedServer, setSelectedServer] = useState<VlessConfig | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isConfigLoading, setIsConfigLoading] = useState(false);
  const [isConnectionBusy, setIsConnectionBusy] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const toggleInFlightRef = useRef(false);
  const selectedServerRef = useRef<VlessConfig | null>(null);
  const connectedRef = useRef(false);

  const updateSelectedServerState = useCallback((server: VlessConfig | null) => {
    selectedServerRef.current = server;
    setSelectedServer(server);
  }, []);

  useEffect(() => {
    let pingTimer: number | null = null;
    let disposed = false;
    const schedulePingAll = (force: boolean) => {
      if (disposed) return;
      if (pingTimer !== null) {
        window.clearTimeout(pingTimer);
      }
      pingTimer = window.setTimeout(() => {
        if (disposed) return;
        void (async () => {
          const connectedNow = await window.electronAPI.getConnectionStatus();
          if (connectedNow) return;
          await window.electronAPI.pingAllServers(force);
        })().catch((error) => {
          console.error('Failed to ping servers', error);
        });
        pingTimer = null;
      }, 1200);
    };

    const loadInitialState = async () => {
      const [initialServers, savedServerId, connectionStatus, initialBusy] = await Promise.all([
        window.electronAPI.getServers(),
        window.electronAPI.getSelectedServerId(),
        window.electronAPI.getConnectionStatus(),
        window.electronAPI.getConnectionBusy(),
      ]);
      if (disposed) return;

      setServers(initialServers);
      setIsConnected(connectionStatus);
      connectedRef.current = connectionStatus;
      setIsConnectionBusy(initialBusy);

      if (savedServerId && initialServers.length > 0) {
        const savedServer = initialServers.find(s => s.uuid === savedServerId);
        updateSelectedServerState(savedServer || initialServers[0]);
      } else if (initialServers.length > 0) {
        updateSelectedServerState(initialServers[0]);
      }

      if (initialServers.length > 0) {
        const hasMissingPingData = initialServers.some((s) => !s.pingTime || s.pingTime === 0);
        if (hasMissingPingData) {
          schedulePingAll(true);
        }
      }
    };

    void loadInitialState();

    const handleUpdateServers = (newServers: VlessConfig[]) => {
      setServers(newServers);
      void (async () => {
        const currentSelected = selectedServerRef.current;
        let nextSelected: VlessConfig | null = null;

        if (currentSelected) {
          nextSelected = newServers.find((server) => server.uuid === currentSelected.uuid) ?? null;
        }

        if (!nextSelected && connectedRef.current) {
          try {
            const monitorStatus = await window.electronAPI.getConnectionMonitorStatus();
            if (disposed) return;
            if (monitorStatus.isConnected && monitorStatus.currentServer) {
              nextSelected =
                newServers.find((server) => server.uuid === monitorStatus.currentServer?.uuid) ??
                monitorStatus.currentServer;
            }
          } catch (error) {
            console.error('Failed to reconcile active server after refresh', error);
          }
        }

        if (!nextSelected) {
          nextSelected = newServers[0] ?? null;
        }

        if (!disposed) {
          updateSelectedServerState(nextSelected);
        }
      })();

      if (newServers.length > 0) {
        const hasMissingPingData = newServers.some((s) => !s.pingTime || s.pingTime === 0);
        if (hasMissingPingData) {
          schedulePingAll(false);
        }
      }
    };

    const handleConnectionStatus = (status: boolean) => {
      setIsConnected(status);
      connectedRef.current = status;
      if (status) setConnectionError(null);
    };

    const handleConnectionBusy = (busy: boolean) => {
      setIsConnectionBusy(busy);
    };

    const handleConnectionError = (error: string) => {
      setConnectionError(error);
    };

    const removeUpdateServers = window.electronAPI.onUpdateServers(handleUpdateServers);
    const removeConnectionStatus = window.electronAPI.onConnectionStatus(handleConnectionStatus);
    const removeConnectionBusy = window.electronAPI.onConnectionBusy(handleConnectionBusy);
    const removeConnectionError = window.electronAPI.onConnectionError(handleConnectionError);

    return () => {
      disposed = true;
      if (pingTimer !== null) {
        window.clearTimeout(pingTimer);
      }
      removeUpdateServers();
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
      setIsConnectionBusy(false);
    } finally {
      toggleInFlightRef.current = false;
    }
  }, [selectedServer, isConnected, isConnectionBusy]);

  const saveSubscription = useCallback(async (payload: SaveSubscriptionPayload) => {
    setIsConfigLoading(true);
    try {
      const isSaved = await window.electronAPI.saveSubscription(payload);
      if (!isSaved) {
        return {
          ok: false,
          error: 'Failed to save subscription',
        } as SaveSubscriptionResult;
      }
      return { ok: true } as SaveSubscriptionResult;
    } catch (e) {
      console.error('Failed to save subscription', e);
      return {
        ok: false,
        error: e instanceof Error ? e.message : 'Failed to save subscription',
      } as SaveSubscriptionResult;
    } finally {
      setIsConfigLoading(false);
    }
  }, []);

  const pingAllServers = useCallback(async () => {
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
    selectedServer,
    isConnected,
    connectionError,
    isConnectionBusy,
    isConfigLoading,
    setSelectedServer: selectServer,
    toggleConnection,
    saveSubscription,
    pingAllServers
  };
}
