import { useCallback, useEffect, useState } from 'react';
import {
  ConnectionMode,
  DEFAULT_PERFORMANCE_SETTINGS,
  PerformanceSettings,
} from '@/shared/types';
import type { TunCapabilityStatus } from '@/shared/ipc';
import { useAppSnapshotContext } from './useAppSnapshot';

export function useNetworkSettings(isOpen: boolean) {
  const { snapshot, refreshSnapshot } = useAppSnapshotContext();
  const [connectionModeOverride, setConnectionModeOverride] = useState<{
    mode: ConnectionMode;
    baseline: ConnectionMode;
  } | null>(null);
  const connectionMode =
    connectionModeOverride !== null &&
    snapshot.connectionMode === connectionModeOverride.baseline
      ? connectionModeOverride.mode
      : snapshot.connectionMode;
  const [tunCapability, setTunCapability] =
    useState<TunCapabilityStatus | null>(null);
  const [modeError, setModeError] = useState<string | null>(null);
  const [perfSettings, setPerfSettings] = useState<PerformanceSettings>(
    DEFAULT_PERFORMANCE_SETTINGS,
  );
  const [perfDirty, setPerfDirty] = useState(false);
  const [perfSaving, setPerfSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    let disposed = false;

    window.electronAPI
      .getPerformanceSettings()
      .then((settings) => {
        if (disposed) return;
        setPerfSettings(settings);
        setPerfDirty(false);
      })
      .catch((err) =>
        console.error('Failed to load performance settings:', err),
      );

    window.electronAPI
      .getTunCapabilityStatus()
      .then((status) => {
        if (!disposed) setTunCapability(status);
      })
      .catch((err) =>
        console.error('Failed to load TUN capability status:', err),
      );

    return () => {
      disposed = true;
    };
  }, [isOpen]);

  const setConnectionMode = useCallback(
    async (mode: ConnectionMode) => {
      const baseline = snapshot.connectionMode;
      await window.electronAPI.setConnectionMode(mode);
      setConnectionModeOverride({ mode, baseline });
      setModeError(null);
      void refreshSnapshot().catch((err) =>
        console.error('Failed to refresh snapshot after mode change:', err),
      );
    },
    [refreshSnapshot, snapshot.connectionMode],
  );

  const updatePerfField = useCallback(
    <K extends keyof PerformanceSettings>(
      key: K,
      value: PerformanceSettings[K],
    ) => {
      setPerfSettings((prev) => ({ ...prev, [key]: value }));
      setPerfDirty(true);
    },
    [],
  );

  const savePerfSettings = useCallback(async () => {
    setPerfSaving(true);
    try {
      await window.electronAPI.setPerformanceSettings(perfSettings);
      setPerfDirty(false);
    } finally {
      setPerfSaving(false);
    }
  }, [perfSettings]);

  const resetPerfDefaults = useCallback(async () => {
    setPerfSettings(DEFAULT_PERFORMANCE_SETTINGS);
    setPerfSaving(true);
    try {
      await window.electronAPI.setPerformanceSettings(
        DEFAULT_PERFORMANCE_SETTINGS,
      );
      setPerfDirty(false);
    } finally {
      setPerfSaving(false);
    }
  }, []);

  return {
    connectionMode,
    setConnectionMode,
    tunCapability,
    modeError,
    setModeError,
    perfSettings,
    perfDirty,
    perfSaving,
    updatePerfField,
    savePerfSettings,
    resetPerfDefaults,
    session: snapshot.session,
  };
}
