import { Dispatch, SetStateAction, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  isSessionPhaseCancellable,
  isSessionPhaseInFlight,
  type SessionPhase,
} from '@/shared/ipc';
import type { VlessConfig } from '@/shared/types';

interface UseConnectionActionsParams {
  selectedServer: VlessConfig | null;
  phase: SessionPhase;
  setConnectionError: Dispatch<SetStateAction<string | null>>;
}

export function useConnectionActions({
  selectedServer,
  phase,
  setConnectionError,
}: UseConnectionActionsParams) {
  const { t } = useTranslation();
  return useCallback(async () => {
    if (!selectedServer) {
      return;
    }
    const canCancel = isSessionPhaseCancellable(phase);
    if (isSessionPhaseInFlight(phase) && !canCancel) {
      return;
    }
    try {
      if (phase === 'connected' || canCancel) {
        const result = await window.electronAPI.disconnect();
        if (!result.ok) {
          setConnectionError(t('status.disconnectFailed'));
          return;
        }
        setConnectionError(null);
      } else {
        setConnectionError(null);
        const result = await window.electronAPI.connect(selectedServer.uuid);
        if (result.relaunched) {
          // Main is handing over to an elevated instance and is about to hide
          // this window; "restarting" is not an error to show.
          return;
        }
        if (!result.ok && result.error) {
          setConnectionError(result.error);
        }
      }
    } catch (error) {
      console.error('Connection toggle failed', error);
      setConnectionError(
        error instanceof Error
          ? error.message
          : t('status.connectionActionFailed'),
      );
    }
  }, [selectedServer, phase, setConnectionError, t]);
}
