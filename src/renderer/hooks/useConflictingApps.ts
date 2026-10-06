import { useCallback, useRef, useState } from 'react';
import type { ConflictingAppsScan } from '@/shared/ipc';

/** Scan results plus per-app close state for {@link ConflictingAppsPanel}. */
export function useConflictingApps() {
  const [scan, setScan] = useState<ConflictingAppsScan | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [closingIds, setClosingIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [failedIds, setFailedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const scanSeqRef = useRef(0);

  const runScan = useCallback(async (): Promise<ConflictingAppsScan | null> => {
    const seq = ++scanSeqRef.current;
    setScanning(true);
    setError(null);
    try {
      const result = await window.electronAPI.scanConflictingApps();
      if (seq === scanSeqRef.current) {
        setScan(result);
        setFailedIds(new Set());
      }
      return result;
    } catch (err) {
      if (seq === scanSeqRef.current) {
        setError(err instanceof Error ? err.message : String(err));
      }
      return null;
    } finally {
      if (seq === scanSeqRef.current) {
        setScanning(false);
      }
    }
  }, []);

  const closeApp = useCallback(async (appId: string) => {
    setClosingIds((prev) => new Set(prev).add(appId));
    setError(null);
    try {
      const result = await window.electronAPI.closeConflictingApp(appId);
      // This result supersedes a scan still in flight, which therefore will
      // not clear `scanning` itself.
      scanSeqRef.current += 1;
      setScanning(false);
      setScan(result.scan);
      setFailedIds((prev) => {
        const next = new Set(prev);
        if (result.closed) next.delete(appId);
        else next.add(appId);
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setFailedIds((prev) => new Set(prev).add(appId));
    } finally {
      setClosingIds((prev) => {
        const next = new Set(prev);
        next.delete(appId);
        return next;
      });
    }
  }, []);

  return {
    scan,
    scanning,
    error,
    closingIds,
    failedIds,
    runScan,
    closeApp,
  };
}
