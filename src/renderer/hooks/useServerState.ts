import { useState, useEffect, useCallback } from 'react';
import { VlessConfig } from '../../shared/types';

/**
 * Custom hook for managing the application's server state and connection status.
 * Interacts with the Main process via `window.electronAPI`.
 * 
 * @returns {object} The server state and action handlers.
 */
export function useServerState() {
  const [servers, setServers] = useState<VlessConfig[]>([]);
  const [selectedServer, setSelectedServer] = useState<VlessConfig | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isConfigLoading, setIsConfigLoading] = useState(false);
  const [lastPingTime, setLastPingTime] = useState<number>(0);

  useEffect(() => {
    // Initial load of servers and state from the main process
    const loadInitialState = async () => {
      const [initialServers, savedServerId, connectionStatus] = await Promise.all([
        window.electronAPI.getServers(),
        window.electronAPI.getSelectedServerId(),
        window.electronAPI.getConnectionStatus()
      ]);

      setServers(initialServers);
      setIsConnected(connectionStatus);

      // Restore selected server from saved ID
      if (savedServerId && initialServers.length > 0) {
        const savedServer = initialServers.find(s => s.uuid === savedServerId);
        if (savedServer) {
          setSelectedServer(savedServer);
        } else if (initialServers.length > 0) {
          // If saved server not found, select first
          setSelectedServer(initialServers[0]);
        }
      } else if (initialServers.length > 0) {
        setSelectedServer(initialServers[0]);
      }

      // Automatically ping all servers after initial load
      // Force ping on initial load to ensure all servers get pinged
      if (initialServers.length > 0) {
        try {
          // Check if any servers are missing ping data
          const serversWithoutPing = initialServers.filter(s => !s.pingTime || s.pingTime === 0);
          const shouldForcePing = serversWithoutPing.length > 0;
          
          // Force ping if any servers don't have ping data, otherwise respect rate limiting
          await window.electronAPI.pingAllServers(shouldForcePing);
          setLastPingTime(Date.now());
        } catch (error) {
          console.error('Failed to ping servers', error);
        }
      }
    };

    loadInitialState();

    // Listen for updates to the server list
    const handleUpdateServers = async (newServers: VlessConfig[]) => {
      setServers(newServers);
      
      // Preserve selection if it still exists in the new list
      setSelectedServer((currentSelected) => {
        if (newServers.length === 0) {
          return null;
        }
        
        if (currentSelected) {
          const found = newServers.find(s => s.uuid === currentSelected.uuid);
          if (found) {
            return found;
          }
        }
        
        // If current selection is gone or null, select first
        return newServers[0];
      });

      // Ping servers when list is updated (e.g., after subscription refresh)
      // Server-side will check if ping is needed (respects rate limiting)
      if (newServers.length > 0) {
        try {
          // Pass false to respect server-side rate limiting
          await window.electronAPI.pingAllServers(false);
          setLastPingTime(Date.now());
        } catch (error) {
          console.error('Failed to ping servers after update', error);
        }
      }
    };

    window.electronAPI.onUpdateServers(handleUpdateServers);

    // Listen for connection status changes
    const handleConnectionStatus = (status: boolean) => {
      setIsConnected(status);
    };
    window.electronAPI.onConnectionStatus(handleConnectionStatus);

    // Cleanup listeners on unmount
    return () => {
      // Note: ipcRenderer.removeListener would be needed if we had access to it
      // For now, the listeners will be cleaned up when the component unmounts
    };
  }, []); // Intentionally empty deps

  /**
   * Toggles the connection to the currently selected server.
   */
  const toggleConnection = useCallback(() => {
    if (!selectedServer) return;
    if (isConnected) {
      window.electronAPI.disconnect();
    } else {
      window.electronAPI.connect(selectedServer);
    }
  }, [selectedServer, isConnected]);

  /**
   * Saves a new subscription URL.
   * @param {string} url - The subscription URL.
   */
  const saveSubscription = useCallback(async (url: string) => {
    if (url) {
      setIsConfigLoading(true);
      try {
        await window.electronAPI.saveSubscription(url);
      } catch (e) {
        console.error('Failed to save subscription', e);
      } finally {
        setIsConfigLoading(false);
      }
    }
  }, []);

  /**
   * Pings all servers and updates their ping values.
   * Manual ping (from button) always executes regardless of time restrictions.
   */
  const pingAllServers = useCallback(async () => {
    try {
      // Pass true to force ping even if recently pinged
      await window.electronAPI.pingAllServers(true);
      setLastPingTime(Date.now());
    } catch (error) {
      console.error('Failed to ping all servers', error);
    }
  }, []);

  /**
   * Pings a single server.
   * @param {VlessConfig} server - The server to ping.
   */
  const pingServer = useCallback(async (server: VlessConfig) => {
    try {
      const result = await window.electronAPI.pingServer(server);
      // Update the server in the list
      setServers((currentServers) =>
        currentServers.map((s) =>
          s.uuid === result.uuid
            ? { ...s, ping: result.latency, pingTime: Date.now() }
            : s
        )
      );
      return result;
    } catch (error) {
      console.error('Failed to ping server', error);
      return { uuid: server.uuid, latency: null };
    }
  }, []);

  return {
    servers,
    selectedServer,
    isConnected,
    isConfigLoading,
    setSelectedServer,
    toggleConnection,
    saveSubscription,
    pingAllServers,
    pingServer
  };
}
