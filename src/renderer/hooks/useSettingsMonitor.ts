import { useEffect, useState } from 'react';
import { ConnectionMonitorEvent } from '@/shared/ipc';

interface UseSettingsMonitorOptions {
  isOpen: boolean;
}

/** Probe event log only. Status/policy live on the app snapshot. */
export function useSettingsMonitor({ isOpen }: UseSettingsMonitorOptions) {
  const [recentEvents, setRecentEvents] = useState<ConnectionMonitorEvent[]>(
    [],
  );

  useEffect(() => {
    if (!isOpen) return;

    const removeMonitorListener = window.electronAPI.onConnectionMonitorEvent(
      (event: ConnectionMonitorEvent) => {
        setRecentEvents((prev) => [event, ...prev].slice(0, 10));
      },
    );

    return () => {
      removeMonitorListener();
    };
  }, [isOpen]);

  return { recentEvents };
}
