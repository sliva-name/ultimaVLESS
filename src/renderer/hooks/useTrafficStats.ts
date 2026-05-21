import { useEffect, useState } from 'react';
import type { TrafficSnapshot } from '@/shared/ipc';

export function useTrafficStats(): TrafficSnapshot | null {
  const [trafficSnapshot, setTrafficSnapshot] =
    useState<TrafficSnapshot | null>(null);

  useEffect(() => {
    let disposed = false;

    const removeTrafficStats = window.electronAPI.onTrafficStats(
      (snapshot) => {
        setTrafficSnapshot(snapshot);
      },
    );

    void window.electronAPI
      .getTrafficStats()
      .then((snapshot) => {
        if (!disposed) {
          setTrafficSnapshot(snapshot);
        }
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      removeTrafficStats();
    };
  }, []);

  return trafficSnapshot;
}
