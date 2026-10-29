import { useEffect, useState } from 'react';
import type { TrafficSnapshot } from '@/shared/ipc';

/** Session length that ticks between the 1 s traffic samples. */
export function useSessionDuration(traffic: TrafficSnapshot | null): number {
  const connectedAt = traffic?.connectedAt ?? 0;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!connectedAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [connectedAt]);
  if (!traffic) return 0;
  return Math.max(
    traffic.sessionDurationMs,
    connectedAt ? now - connectedAt : 0,
  );
}
