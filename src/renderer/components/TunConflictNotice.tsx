import React, { useState } from 'react';
import type { TunConflictCheck } from '@/shared/ipc';
import type { ConnectionMode } from '@/shared/types';
import { ConflictingAppsPanel } from './ConflictingAppsPanel';

interface TunConflictNoticeProps {
  check: TunConflictCheck | null;
  connectionMode: ConnectionMode;
}

const NO_IDS: ReadonlySet<string> = new Set();

/**
 * Other VPN/proxy software found by the check main runs on every TUN connect
 * attempt. Shown as a banner above the main view so it cannot scroll out of
 * sight under the session stats once the tunnel is (nominally) up.
 */
export const TunConflictNotice: React.FC<TunConflictNoticeProps> = ({
  check,
  connectionMode,
}) => {
  const [dismissedId, setDismissedId] = useState<number | null>(null);
  const [closingIds, setClosingIds] = useState<ReadonlySet<string>>(NO_IDS);
  const [failed, setFailed] = useState<{
    checkId: number;
    ids: ReadonlySet<string>;
  } | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!check || connectionMode !== 'tun' || dismissedId === check.id) {
    return null;
  }
  const scan = check.scan;
  if (!scan?.supported) return null;
  if (scan.apps.length === 0 && !check.resolved) return null;

  const checkId = check.id;
  const failedIds = failed?.checkId === checkId ? failed.ids : NO_IDS;

  const markFailed = (appId: string, didFail: boolean) => {
    setFailed((prev) => {
      const ids = new Set(prev?.checkId === checkId ? prev.ids : NO_IDS);
      if (didFail) ids.add(appId);
      else ids.delete(appId);
      return { checkId, ids };
    });
  };

  // Main refreshes `check` in the next snapshot; only per-click state is local.
  const closeApp = async (appId: string) => {
    setClosingIds((prev) => new Set(prev).add(appId));
    setError(null);
    try {
      const result = await window.electronAPI.closeConflictingApp(appId);
      markFailed(appId, !result.closed);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      markFailed(appId, true);
    } finally {
      setClosingIds((prev) => {
        const next = new Set(prev);
        next.delete(appId);
        return next;
      });
    }
  };

  const rescan = async () => {
    setScanning(true);
    setError(null);
    try {
      await window.electronAPI.scanConflictingApps();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setScanning(false);
    }
  };

  return (
    <ConflictingAppsPanel
      scan={scan}
      scanning={scanning}
      error={error}
      closingIds={closingIds}
      failedIds={failedIds}
      resolved={check.resolved}
      onCloseApp={(appId) => void closeApp(appId)}
      onRescan={() => void rescan()}
      onDismiss={() => setDismissedId(checkId)}
      className="z-20 shrink-0 mx-3 mt-2 max-h-[45vh] overflow-y-auto animate-[fadeIn_0.3s_ease-out]"
    />
  );
};
