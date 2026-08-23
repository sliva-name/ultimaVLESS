import { Dispatch, SetStateAction, useCallback } from 'react';
import type { VlessConfig } from '@/shared/types';

interface UseConnectionActionsParams {
  selectedServer: VlessConfig | null;
  isConnected: boolean;
  isConnectionBusy: boolean;
  setConnectionError: Dispatch<SetStateAction<string | null>>;
}

export function useConnectionActions({
  selectedServer,
  isConnected,
  isConnectionBusy,
  setConnectionError,
}: UseConnectionActionsParams) {
  return useCallback(async () => {
    if (!selectedServer || isConnectionBusy) {
      return;
    }
    try {
      if (isConnected) {
        const result = await window.electronAPI.disconnect();
        if (!result.ok) {
          setConnectionError('Failed to disconnect cleanly');
          return;
        }
        setConnectionError(null);
      } else {
        setConnectionError(null);
        const result = await window.electronAPI.connect(selectedServer.uuid);
        if (!result.ok && result.error) {
          setConnectionError(result.error);
        }
      }
    } catch (error) {
      console.error('Connection toggle failed', error);
      setConnectionError(
        error instanceof Error ? error.message : 'Connection operation failed',
      );
    }
  }, [selectedServer, isConnected, isConnectionBusy, setConnectionError]);
}
