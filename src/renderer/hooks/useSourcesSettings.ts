import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Subscription } from '@/shared/types';
import { YANDEX_TRANSLATED_MOBILE_LIST_URL } from '@/shared/subscriptionUrls';

/**
 * Server sources: subscriptions, the manual links and the mobile white-list
 * import. Shared by the desktop settings tab and the Android screen.
 */
export function useSourcesSettings(isOpen: boolean) {
  const { t } = useTranslation();

  const [manualLinks, setManualLinks] = useState('');
  const [manualSaveError, setManualSaveError] = useState<string | null>(null);
  const [isSavingManual, setIsSavingManual] = useState(false);

  const [newSubName, setNewSubName] = useState('');
  const [newSubUrl, setNewSubUrl] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);

  const [importingMobileList, setImportingMobileList] = useState(false);
  const [importMobileError, setImportMobileError] = useState<string | null>(
    null,
  );

  useEffect(() => {
    if (!isOpen) return;
    let disposed = false;

    window.electronAPI
      .getManualLinks()
      .then((links) => {
        if (!disposed) setManualLinks(links || '');
      })
      .catch((err) => console.error('Failed to load manual links:', err));

    return () => {
      disposed = true;
    };
  }, [isOpen]);

  const toggleSubscription = useCallback(async (sub: Subscription) => {
    try {
      await window.electronAPI.updateSubscription({
        id: sub.id,
        patch: { enabled: !sub.enabled },
      });
    } catch (err) {
      console.error('Failed to toggle subscription', err);
    }
  }, []);

  const deleteSubscription = useCallback(async (id: string) => {
    try {
      await window.electronAPI.deleteSubscription(id);
    } catch (err) {
      console.error('Failed to delete subscription', err);
    }
  }, []);

  /** Resolves to true once the subscription is added and fetched. */
  const addSubscription = useCallback(async (): Promise<boolean> => {
    setAddError(null);
    const name = newSubName.trim();
    const url = newSubUrl.trim();
    if (!name) {
      setAddError(t('settings.sources.errors.nameRequired'));
      return false;
    }
    if (!url) {
      setAddError(t('settings.sources.errors.urlRequired'));
      return false;
    }

    setIsAdding(true);
    try {
      const result = await window.electronAPI.addSubscription({ name, url });
      if (!result.ok) {
        setAddError(result.error || t('settings.sources.errors.fetchFailed'));
        return false;
      }
      setNewSubName('');
      setNewSubUrl('');
      return true;
    } catch (err) {
      setAddError(
        err instanceof Error
          ? err.message
          : t('settings.sources.errors.addFailed'),
      );
      return false;
    } finally {
      setIsAdding(false);
    }
  }, [newSubName, newSubUrl, t]);

  const importMobileList = useCallback(async () => {
    setImportMobileError(null);
    setImportingMobileList(true);
    try {
      const [openResult, importResult] = await Promise.allSettled([
        window.electronAPI.openExternalUrl(YANDEX_TRANSLATED_MOBILE_LIST_URL),
        window.electronAPI.importMobileWhiteListSubscription(),
      ]);
      if (openResult.status === 'rejected') {
        console.error(
          'Failed to open translated list in browser',
          openResult.reason,
        );
      }
      if (importResult.status === 'rejected') {
        const msg =
          importResult.reason instanceof Error
            ? importResult.reason.message
            : String(importResult.reason);
        setImportMobileError(msg);
        return;
      }
      const data = importResult.value;
      if (!data.ok) {
        setImportMobileError(
          data.error || t('settings.sources.errors.loadFailed'),
        );
      }
    } finally {
      setImportingMobileList(false);
    }
  }, [t]);

  const saveManualLinks = useCallback(async () => {
    setManualSaveError(null);
    setIsSavingManual(true);
    try {
      const result = await window.electronAPI.saveManualLinks(manualLinks);
      if (!result.ok && result.error) {
        setManualSaveError(result.error);
      }
    } catch (err) {
      setManualSaveError(
        err instanceof Error
          ? err.message
          : t('settings.sources.errors.saveManualFailed'),
      );
    } finally {
      setIsSavingManual(false);
    }
  }, [manualLinks, t]);

  return {
    manualLinks,
    setManualLinks,
    manualSaveError,
    isSavingManual,
    saveManualLinks,
    newSubName,
    setNewSubName,
    newSubUrl,
    setNewSubUrl,
    addError,
    setAddError,
    isAdding,
    addSubscription,
    importingMobileList,
    importMobileError,
    importMobileList,
    toggleSubscription,
    deleteSubscription,
  };
}
