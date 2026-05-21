import { Dispatch, RefObject, SetStateAction, useCallback } from 'react';
import type { VlessConfig } from '@/shared/types';

interface UseConnectionActionsParams {
  selectedServer: VlessConfig | null;
  isConnected: boolean;
  isConnectionBusy: boolean;
  toggleInFlightRef: RefObject<boolean>;
  setConnectionError: Dispatch<SetStateAction<string | null>>;
  setIsConnectionBusy: Dispatch<SetStateAction<boolean>>;
}

export function useConnectionActions({
  selectedServer,
  isConnected,
  isConnectionBusy,
  toggleInFlightRef,
  setConnectionError,
  setIsConnectionBusy,
}: UseConnectionActionsParams) {
  return useCallback(async () => {
    if (!selectedServer || isConnectionBusy || toggleInFlightRef.current) {
      return;
    }
    toggleInFlightRef.current = true;
    setIsConnectionBusy(true);
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
        const result = await window.electronAPI.connect(selectedServer);
        if (!result.ok && result.error) {
          setConnectionError(result.error);
        }
      }
    } catch (error) {
      console.error('Connection toggle failed', error);
      setConnectionError(
        error instanceof Error ? error.message : 'Connection operation failed',
      );
    } finally {
      toggleInFlightRef.current = false;
      try {
        const busy = await window.electronAPI.getConnectionBusy();
        setIsConnectionBusy(busy);
      } catch {
        setIsConnectionBusy(false);
      }
    }
  }, [
    selectedServer,
    isConnected,
    isConnectionBusy,
    toggleInFlightRef,
    setConnectionError,
    setIsConnectionBusy,
  ]);
}
