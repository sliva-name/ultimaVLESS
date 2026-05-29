import { useCallback, useEffect, useState } from 'react';
import {
  ConnectionMode,
  DEFAULT_PERFORMANCE_SETTINGS,
  PerformanceSettings,
} from '@/shared/types';
import type { TunCapabilityStatus } from '@/shared/ipc';
import { useAppSnapshot } from './useAppSnapshot';

export function useNetworkSettings(isOpen: boolean) {
  const snapshot = useAppSnapshot();
  const [connectionMode, setConnectionModeState] = useState<ConnectionMode>(
    snapshot.connectionMode,
  );
  const [tunCapability, setTunCapability] =
    useState<TunCapabilityStatus | null>(null);
  const [modeError, setModeError] = useState<string | null>(null);
  const [perfSettings, setPerfSettings] = useState<PerformanceSettings>(
    DEFAULT_PERFORMANCE_SETTINGS,
  );
  const [perfDirty, setPerfDirty] = useState(false);
  const [perfSaving, setPerfSaving] = useState(false);

  useEffect(() => {
    setConnectionModeState(snapshot.connectionMode);
  }, [snapshot.connectionMode]);

  useEffect(() => {
    if (!isOpen) return;

    window.electronAPI
      .getPerformanceSettings()
      .then((settings) => {
        setPerfSettings(settings);
        setPerfDirty(false);
      })
      .catch((err) =>
        console.error('Failed to load performance settings:', err),
      );

    window.electronAPI
      .getTunCapabilityStatus()
      .then(setTunCapability)
      .catch((err) =>
        console.error('Failed to load TUN capability status:', err),
      );
  }, [isOpen]);

  const setConnectionMode = useCallback(async (mode: ConnectionMode) => {
    await window.electronAPI.setConnectionMode(mode);
    setConnectionModeState(mode);
    setModeError(null);
  }, []);

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
