import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

/** "Refresh all": every subscription is fetched again in one call. */
export function useRefreshSubscriptions() {
  const { t } = useTranslation();
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const refreshAll = useCallback(async () => {
    setRefreshError(null);
    setRefreshing(true);
    try {
      const result = await window.electronAPI.refreshSubscriptions();
      if (!result.ok && result.error) setRefreshError(result.error);
    } catch (err) {
      setRefreshError(
        err instanceof Error
          ? err.message
          : t('settings.sources.errors.fetchFailed'),
      );
    } finally {
      setRefreshing(false);
    }
  }, [t]);

  return { refreshing, refreshError, refreshAll };
}
