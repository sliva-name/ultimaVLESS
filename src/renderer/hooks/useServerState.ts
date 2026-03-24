import { useState, useEffect, useCallback } from 'react';
import { VlessConfig } from '../../shared/types';

export function useServerState() {
  type SaveSubscriptionResult = { ok: true } | { ok: false; error: string };
  const [servers, setServers] = useState<VlessConfig[]>([]);
  const [selectedServer, setSelectedServer] = useState<VlessConfig | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isConfigLoading, setIsConfigLoading] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  useEffect(() => {
    const loadInitialState = async () => {
      const [initialServers, savedServerId, connectionStatus] = await Promise.all([
        window.electronAPI.getServers(),
        window.electronAPI.getSelectedServerId(),
        window.electronAPI.getConnectionStatus()
      ]);

      setServers(initialServers);
      setIsConnected(connectionStatus);

      if (savedServerId && initialServers.length > 0) {
        const savedServer = initialServers.find(s => s.uuid === savedServerId);
        setSelectedServer(savedServer || initialServers[0]);
      } else if (initialServers.length > 0) {
        setSelectedServer(initialServers[0]);
      }

      if (initialServers.length > 0) {
        try {
          const hasMissingPingData = initialServers.some((s) => !s.pingTime || s.pingTime === 0);
          if (hasMissingPingData) {
            await window.electronAPI.pingAllServers(true);
          }
        } catch (error) {
          console.error('Failed to ping servers', error);
        }
      }
    };

    loadInitialState();

    const handleUpdateServers = async (newServers: VlessConfig[]) => {
      setServers(newServers);
      
      setSelectedServer((currentSelected) => {
        if (newServers.length === 0) return null;
        if (currentSelected) {
          const found = newServers.find(s => s.uuid === currentSelected.uuid);
          if (found) return found;
        }
        return newServers[0];
      });

      if (newServers.length > 0) {
        try {
          // Only trigger auto-ping when fresh server list has missing ping data.
          // This avoids repeated ping loops on update-servers events.
          const hasMissingPingData = newServers.some((s) => !s.pingTime || s.pingTime === 0);
          if (hasMissingPingData) {
            await window.electronAPI.pingAllServers(false);
          }
        } catch (error) {
          console.error('Failed to ping servers after update', error);
        }
      }
    };

    const handleConnectionStatus = (status: boolean) => {
      setIsConnected(status);
      if (status) setConnectionError(null);
    };

    const handleConnectionError = (error: string) => {
      setConnectionError(error);
    };

    const removeUpdateServers = window.electronAPI.onUpdateServers(handleUpdateServers);
    const removeConnectionStatus = window.electronAPI.onConnectionStatus(handleConnectionStatus);
    const removeConnectionError = window.electronAPI.onConnectionError(handleConnectionError);

    return () => {
      removeUpdateServers();
      removeConnectionStatus();
      removeConnectionError();
    };
  }, []);

  const toggleConnection = useCallback(() => {
    if (!selectedServer) return;
    if (isConnected) {
      window.electronAPI.disconnect();
      setConnectionError(null);
    } else {
      setConnectionError(null);
      window.electronAPI.connect(selectedServer);
    }
  }, [selectedServer, isConnected]);

  const saveSubscription = useCallback(async (payload: { subscriptionUrl: string; manualLinks: string }) => {
    setIsConfigLoading(true);
    try {
      await window.electronAPI.saveSubscription(payload);
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

  return {
    servers,
    selectedServer,
    isConnected,
    connectionError,
    isConfigLoading,
    setSelectedServer,
    toggleConnection,
    saveSubscription,
    pingAllServers
  };
}
