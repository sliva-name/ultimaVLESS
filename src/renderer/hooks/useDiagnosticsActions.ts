import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Connection-monitor switches and log export. Shared by the desktop
 * diagnostics tab and the Android screen.
 */
export function useDiagnosticsActions() {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);

  const toggleAutoSwitching = useCallback(async (enabled: boolean) => {
    try {
      await window.electronAPI.setAutoSwitching(enabled);
    } catch (err) {
      console.error('Failed to toggle auto-switching:', err);
    }
  }, []);

  const clearBlocked = useCallback(async () => {
    try {
      await window.electronAPI.clearBlockedServers();
    } catch (err) {
      console.error('Failed to clear blocked servers:', err);
    }
  }, []);

  const copyLogs = useCallback(async () => {
    setCopyError(null);
    try {
      const logs = await window.electronAPI.getLogs();
      await navigator.clipboard.writeText(logs);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy logs', error);
      setCopyError(t('settings.diagnostics.copyLogsFailed'));
      setCopied(false);
    }
  }, [t]);

  const openLogFolder = useCallback(() => {
    void window.electronAPI.openLogFolder().catch((error) => {
      console.error('Failed to open log folder', error);
    });
  }, []);

  return {
    copied,
    copyError,
    toggleAutoSwitching,
    clearBlocked,
    copyLogs,
    openLogFolder,
  };
}
