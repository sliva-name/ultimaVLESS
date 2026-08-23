import { useCallback, useEffect, useState } from 'react';
import {
  ConnectionMonitorEvent,
  ConnectionMonitorStatus,
} from '@/shared/ipc';

interface UseSettingsMonitorOptions {
  isOpen: boolean;
}

export function useSettingsMonitor({ isOpen }: UseSettingsMonitorOptions) {
  const [monitorStatus, setMonitorStatus] =
    useState<ConnectionMonitorStatus | null>(null);
  const [recentEvents, setRecentEvents] = useState<ConnectionMonitorEvent[]>(
    [],
  );
  const [autoSwitching, setAutoSwitching] = useState(true);
  const [hasLoadedMonitorStatus, setHasLoadedMonitorStatus] = useState(false);

  const applyMonitorStatus = useCallback((status: ConnectionMonitorStatus) => {
    setMonitorStatus(status);
    setAutoSwitching(status.autoSwitchingEnabled ?? true);
  }, []);

  const loadMonitorStatus = useCallback(async () => {
    try {
      const status = await window.electronAPI.getConnectionMonitorStatus();
      applyMonitorStatus(status);
    } catch (err) {
      console.error('Failed to load monitor status:', err);
    } finally {
      setHasLoadedMonitorStatus(true);
    }
  }, [applyMonitorStatus]);

  useEffect(() => {
    if (!isOpen) return;

    window.electronAPI
      .getConnectionMonitorStatus()
      .then(applyMonitorStatus)
      .catch((err) => console.error('Failed to load monitor status:', err))
      .finally(() => setHasLoadedMonitorStatus(true));

    const handleMonitorEvent = (event: ConnectionMonitorEvent) => {
      setRecentEvents((prev) => [event, ...prev].slice(0, 10));
      void loadMonitorStatus();
    };

    const removeMonitorListener =
      window.electronAPI.onConnectionMonitorEvent(handleMonitorEvent);

    return () => {
      removeMonitorListener();
    };
  }, [isOpen, loadMonitorStatus, applyMonitorStatus]);

  return {
    monitorStatus,
    recentEvents,
    autoSwitching,
    hasLoadedMonitorStatus,
    setAutoSwitching,
    loadMonitorStatus,
  };
}
