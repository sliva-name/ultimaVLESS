import { useCallback, useEffect, useRef, useState } from 'react';
import { ConnectionMonitorEvent, ConnectionStatus as MonitorStatus } from '@/renderer/preload.d';

interface UseSettingsMonitorOptions {
  isOpen: boolean;
}

export function useSettingsMonitor({ isOpen }: UseSettingsMonitorOptions) {
  const [monitorStatus, setMonitorStatus] = useState<MonitorStatus | null>(null);
  const [recentEvents, setRecentEvents] = useState<ConnectionMonitorEvent[]>([]);
  const [autoSwitching, setAutoSwitching] = useState(true);
  const [hasLoadedMonitorStatus, setHasLoadedMonitorStatus] = useState(false);
  const loadMonitorStatusRef = useRef<(() => Promise<void>) | null>(null);

  const loadMonitorStatus = useCallback(async () => {
    try {
      const status = await window.electronAPI.getConnectionMonitorStatus();
      setMonitorStatus(status);
      setAutoSwitching(status.autoSwitchingEnabled ?? true);
    } catch (err) {
      console.error('Failed to load monitor status:', err);
    } finally {
      setHasLoadedMonitorStatus(true);
    }
  }, []);

  loadMonitorStatusRef.current = loadMonitorStatus;

  useEffect(() => {
    if (!isOpen) return;
    setHasLoadedMonitorStatus(false);

    void loadMonitorStatus();

    const handleMonitorEvent = (event: ConnectionMonitorEvent) => {
      setRecentEvents((prev) => [event, ...prev].slice(0, 10));
      void loadMonitorStatusRef.current?.();
    };

    const removeMonitorListener = window.electronAPI.onConnectionMonitorEvent(handleMonitorEvent);
    const interval = setInterval(loadMonitorStatus, 5000);

    return () => {
      removeMonitorListener();
      clearInterval(interval);
    };
  }, [isOpen, loadMonitorStatus]);

  return {
    monitorStatus,
    recentEvents,
    autoSwitching,
    hasLoadedMonitorStatus,
    setAutoSwitching,
    loadMonitorStatus,
  };
}
