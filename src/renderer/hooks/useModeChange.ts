import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { ConnectionMode } from '@/shared/types';
import type { NetworkSettings } from './useNetworkSettings';

/**
 * Proxy ⇄ TUN from the title bar or the network page. A connected session
 * restarts in the new mode; only in-flight work blocks the change.
 */
export function useModeChange(
  net: Pick<
    NetworkSettings,
    'connectionMode' | 'setConnectionMode' | 'setModeError' | 'tunCapability'
  >,
  isConnectionBusy: boolean,
) {
  const { t } = useTranslation();
  const { connectionMode, setConnectionMode, setModeError, tunCapability } =
    net;

  return useCallback(
    async (mode: ConnectionMode) => {
      if (mode === connectionMode) return;
      if (isConnectionBusy) {
        setModeError(t('settings.network.disconnectHintError'));
        return;
      }
      if (mode === 'tun' && tunCapability && !tunCapability.supported) {
        setModeError(
          tunCapability.platform === 'darwin'
            ? t('settings.network.tunUnsupportedDarwin')
            : t('settings.network.tunUnavailable'),
        );
        return;
      }
      try {
        await setConnectionMode(mode);
      } catch (err) {
        console.error('Failed to set connection mode:', err);
        setModeError(
          err instanceof Error
            ? err.message
            : t('settings.network.setModeFailed'),
        );
      }
    },
    [
      connectionMode,
      isConnectionBusy,
      setConnectionMode,
      setModeError,
      t,
      tunCapability,
    ],
  );
}
