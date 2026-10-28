import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppOption } from '@/shared/appRouting';

const RUNNING_APPS_REFRESH_MS = 10_000;

/**
 * Apps the routing editors can offer: running programs on desktop (installed
 * packages on Android) plus files picked earlier, which keep their icon even
 * when they are not running.
 */
export function useKnownApps() {
  const [runningApps, setRunningApps] = useState<AppOption[]>([]);
  const [pickedApps, setPickedApps] = useState<AppOption[]>([]);
  const [appsLoading, setAppsLoading] = useState(true);
  const lastFetchRef = useRef(0);
  const mountedRef = useRef(true);

  const loadRunningApps = useCallback(() => {
    lastFetchRef.current = Date.now();
    return window.electronAPI
      .listRunningApps()
      .then(
        (apps) => {
          if (mountedRef.current) setRunningApps(apps);
        },
        (err) => console.error('Failed to list running apps:', err),
      )
      .finally(() => {
        if (mountedRef.current) setAppsLoading(false);
      });
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void loadRunningApps();
    return () => {
      mountedRef.current = false;
    };
  }, [loadRunningApps]);

  // Programs started after the settings opened appear the next time a list
  // opens; the throttle keeps PowerShell from running on every click.
  const refreshRunningApps = useCallback(() => {
    if (appsLoading) return;
    if (Date.now() - lastFetchRef.current < RUNNING_APPS_REFRESH_MS) return;
    setAppsLoading(true);
    void loadRunningApps();
  }, [appsLoading, loadRunningApps]);

  const rememberPicked = useCallback((apps: AppOption[]) => {
    setPickedApps((prev) => [
      ...prev.filter((known) => !apps.some((app) => app.name === known.name)),
      ...apps,
    ]);
  }, []);

  const knownApps = useMemo(() => {
    const running = new Set(runningApps.map((app) => app.name));
    return [
      ...runningApps,
      ...pickedApps.filter((app) => !running.has(app.name)),
    ];
  }, [pickedApps, runningApps]);

  return { knownApps, appsLoading, refreshRunningApps, rememberPicked };
}
