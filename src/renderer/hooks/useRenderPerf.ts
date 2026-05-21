import { useLayoutEffect } from 'react';
import { isPerfLoggingEnabled, perfMark } from '@/shared/perfMetrics';

/**
 * Logs layout-to-next-update duration in dev/debug builds (React Profiler-lite).
 */
export function useRenderPerf(componentName: string, deps: unknown[]): void {
  useLayoutEffect(() => {
    if (!isPerfLoggingEnabled()) {
      return;
    }

    const startedAt =
      typeof performance !== 'undefined' ? performance.now() : Date.now();

    return () => {
      const endedAt =
        typeof performance !== 'undefined' ? performance.now() : Date.now();
      const durationMs = Math.round(endedAt - startedAt);
      perfMark('Renderer', `${componentName} commit`, { durationMs });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional dep snapshot
  }, deps);
}
