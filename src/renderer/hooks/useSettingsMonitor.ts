import { useCallback, useEffect, useState } from 'react';
import {
  ConnectionMonitorEvent,
  ConnectionStatus as MonitorStatus,
} from '@/renderer/preload.d';

interface UseSettingsMonitorOptions {
  isOpen: boolean;
}

export function useSettingsMonitor({ isOpen }: UseSettingsMonitorOptions) {
  const [monitorStatus, setMonitorStatus] = useState<MonitorStatus | null>(
    null,
  );
  const [recentEvents, setRecentEvents] = useState<ConnectionMonitorEvent[]>(
    [],
  );
  const [autoSwitching, setAutoSwitching] = useState(true);
  const [hasLoadedMonitorStatus, setHasLoadedMonitorStatus] = useState(false);

  const applyMonitorStatus = useCallback((status: MonitorStatus) => {
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
    const interval = setInterval(loadMonitorStatus, 5000);

    return () => {
      removeMonitorListener();
      clearInterval(interval);
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
