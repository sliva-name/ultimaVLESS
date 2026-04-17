import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, Link2, ExternalLink, Plus, Trash2, ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Subscription } from '@/shared/types';
import { YANDEX_TRANSLATED_MOBILE_LIST_URL } from '@/shared/subscriptionUrls';
import { PrimaryButton, Toggle } from '@/renderer/components/ui';

interface SettingsSourcesTabProps {
  subscriptions: Subscription[];
  isOpen: boolean;
}

export const SettingsSourcesTab: React.FC<SettingsSourcesTabProps> = ({
  subscriptions,
  isOpen,
}) => {
  const { t } = useTranslation();

  const [manualLinks, setManualLinks] = useState('');
  const [isManualExpanded, setIsManualExpanded] = useState(false);
  const [manualSaveError, setManualSaveError] = useState<string | null>(null);
  const [isSavingManual, setIsSavingManual] = useState(false);

  const [isAddFormExpanded, setIsAddFormExpanded] = useState(false);
  const [newSubName, setNewSubName] = useState('');
  const [newSubUrl, setNewSubUrl] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);

  const [importingMobileList, setImportingMobileList] = useState(false);
  const [importMobileError, setImportMobileError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setManualSaveError(null);
    setImportMobileError(null);
    setAddError(null);

    window.electronAPI.getManualLinks()
      .then((links) => setManualLinks(links || ''))
      .catch((err) => console.error('Failed to load manual links:', err));
  }, [isOpen]);

  const handleToggleSubscription = useCallback(async (sub: Subscription) => {
    try {
      await window.electronAPI.updateSubscription({ id: sub.id, patch: { enabled: !sub.enabled } });
    } catch (err) {
      console.error('Failed to toggle subscription', err);
    }
  }, []);

  const handleDeleteSubscription = useCallback(async (id: string) => {
    try {
      await window.electronAPI.deleteSubscription(id);
    } catch (err) {
      console.error('Failed to delete subscription', err);
    }
  }, []);

  const handleAddSubscription = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setAddError(null);
    const name = newSubName.trim();
    const url = newSubUrl.trim();
    if (!name) { setAddError(t('settings.sources.errors.nameRequired')); return; }
    if (!url) { setAddError(t('settings.sources.errors.urlRequired')); return; }

    setIsAdding(true);
    try {
      const result = await window.electronAPI.addSubscription({ name, url });
      if (!result.ok) {
        setAddError(result.error || t('settings.sources.errors.fetchFailed'));
      } else {
        setNewSubName('');
        setNewSubUrl('');
        setIsAddFormExpanded(false);
      }
    } catch (err) {
      setAddError(err instanceof Error ? err.message : t('settings.sources.errors.addFailed'));
    } finally {
      setIsAdding(false);
    }
  }, [newSubName, newSubUrl, t]);

  const handleOpenYandexTranslatedList = useCallback(async () => {
    setImportMobileError(null);
    setImportingMobileList(true);
    try {
      const [openResult, importResult] = await Promise.allSettled([
        window.electronAPI.openExternalUrl(YANDEX_TRANSLATED_MOBILE_LIST_URL),
        window.electronAPI.importMobileWhiteListSubscription(),
      ]);
      if (openResult.status === 'rejected') {
        console.error('Failed to open translated list in browser', openResult.reason);
      }
      if (importResult.status === 'rejected') {
        const msg = importResult.reason instanceof Error ? importResult.reason.message : String(importResult.reason);
        setImportMobileError(msg);
        return;
      }
      const data = importResult.value;
      if (!data.ok) {
        setImportMobileError(data.error || t('settings.sources.errors.loadFailed'));
      }
    } finally {
      setImportingMobileList(false);
    }
  }, [t]);

  const handleSaveManualLinks = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setManualSaveError(null);
    setIsSavingManual(true);
    try {
      const result = await window.electronAPI.saveManualLinks(manualLinks);
      if (!result.ok && result.error) {
        setManualSaveError(result.error);
      }
    } catch (err) {
      setManualSaveError(err instanceof Error ? err.message : t('settings.sources.errors.saveManualFailed'));
    } finally {
      setIsSavingManual(false);
    }
  }, [manualLinks, t]);

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-medium text-gray-300 mb-3">{t('settings.sources.subscriptions')}</p>

        <div className="space-y-2 mb-4">
          {subscriptions.length === 0 && (
            <p className="text-sm text-gray-500 px-0.5 leading-relaxed">{t('settings.sources.noSubscriptions')}</p>
          )}
          {subscriptions.map((sub) => (
            <div
              key={sub.id}
              className="rounded-2xl border border-gray-700/50 bg-gray-900/20 px-4 py-3 flex flex-col gap-3 sm:flex-row sm:items-center"
            >
              <div className="flex-1 min-w-0 w-full sm:w-auto">
                <div className="text-sm font-semibold text-white truncate">{sub.name}</div>
                <div className="text-xs text-gray-400 font-mono mt-1 break-all sm:break-normal leading-relaxed">{sub.url}</div>
              </div>
              <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
                <Toggle
                  checked={sub.enabled}
                  onChange={() => handleToggleSubscription(sub)}
                  title={sub.enabled ? t('settings.sources.disableSubscription') : t('settings.sources.enableSubscription')}
                  ariaLabel={sub.enabled ? t('settings.sources.disableSubscription') : t('settings.sources.enableSubscription')}
                />
                <button
                  type="button"
                  onClick={() => handleDeleteSubscription(sub.id)}
                  className="p-1.5 rounded-lg text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-colors shrink-0"
                  title={t('settings.sources.removeSubscription')}
                  aria-label={t('settings.sources.removeSubscription')}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="rounded-2xl border border-gray-700/50 bg-gray-900/20 overflow-hidden mb-1">
          <button
            type="button"
            onClick={() => { setIsAddFormExpanded((p) => !p); setAddError(null); }}
            aria-expanded={isAddFormExpanded}
            className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-white/5 transition-colors"
          >
            <span className="flex items-center gap-2.5 text-sm font-medium text-gray-200">
              <Plus className="w-5 h-5 text-primary shrink-0" />
              {t('settings.sources.addSubscription')}
            </span>
            <ChevronDown className={`w-5 h-5 text-gray-400 transition-transform shrink-0 ${isAddFormExpanded ? 'rotate-180' : ''}`} />
          </button>
          {isAddFormExpanded && (
            <form onSubmit={handleAddSubscription} className="px-4 pb-4 space-y-3">
              <input
                type="text"
                value={newSubName}
                onChange={(e) => setNewSubName(e.target.value)}
                placeholder={t('settings.sources.namePlaceholder')}
                maxLength={100}
                className="w-full bg-black/40 border border-gray-600/50 rounded-xl px-3 py-2.5 text-sm text-white placeholder:text-gray-500 focus:border-primary/60 focus:ring-2 focus:ring-primary/20 outline-none transition-all"
              />
              <input
                type="text"
                value={newSubUrl}
                onChange={(e) => setNewSubUrl(e.target.value)}
                placeholder={t('settings.sources.urlPlaceholder')}
                className="w-full bg-black/40 border border-gray-600/50 rounded-xl px-3 py-2.5 text-sm text-white placeholder:text-gray-500 focus:border-primary/60 focus:ring-2 focus:ring-primary/20 outline-none transition-all"
              />
              {addError && <p className="text-xs text-orange-400 leading-relaxed">{addError}</p>}
              <PrimaryButton type="submit" disabled={isAdding} block>
                {isAdding ? <Loader2 className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />}
                {isAdding ? t('settings.sources.adding') : t('settings.sources.addAndFetch')}
              </PrimaryButton>
            </form>
          )}
        </div>

        <button
          type="button"
          onClick={handleOpenYandexTranslatedList}
          disabled={importingMobileList}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium text-primary border border-primary/40 bg-primary/5 hover:bg-primary/10 hover:border-primary/60 transition-colors disabled:opacity-50 disabled:cursor-not-allowed leading-snug"
        >
          {importingMobileList ? (
            <Loader2 className="w-5 h-5 shrink-0 animate-spin" />
          ) : (
            <ExternalLink className="w-5 h-5 shrink-0" />
          )}
          {t('settings.sources.openPreview')}
        </button>
        {importMobileError && (
          <p className="text-sm text-orange-400 mt-3 leading-relaxed">{importMobileError}</p>
        )}
      </div>

      <div>
        <form onSubmit={handleSaveManualLinks}>
          <div className="rounded-2xl border border-gray-700/50 bg-gray-900/20 overflow-hidden">
            <button
              type="button"
              onClick={() => setIsManualExpanded((prev) => !prev)}
              aria-expanded={isManualExpanded}
              className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-white/5 transition-colors"
            >
              <span className="flex items-center gap-2.5 text-sm font-medium text-gray-200">
                <Link2 className="w-5 h-5 text-primary shrink-0" />
                {t('settings.sources.manualConfigs')}
              </span>
              <ChevronDown className={`w-5 h-5 text-gray-400 transition-transform shrink-0 ${isManualExpanded ? 'rotate-180' : ''}`} />
            </button>
            {isManualExpanded && (
              <div className="px-4 pb-4">
                <div className="relative group">
                  <textarea
                    value={manualLinks}
                    onChange={(e) => setManualLinks(e.target.value)}
                    rows={6}
                    placeholder={t('settings.sources.manualPlaceholder')}
                    className="w-full resize-y min-h-[120px] bg-black/40 backdrop-blur-sm border border-gray-600/50 rounded-xl px-3 py-3 text-sm text-white placeholder:text-gray-500 focus:border-primary/60 focus:ring-2 focus:ring-primary/20 outline-none transition-all duration-200 hover:border-gray-500/70 leading-relaxed"
                  />
                  <div className="absolute inset-0 rounded-xl bg-linear-to-r from-primary/0 via-primary/5 to-primary/0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />
                </div>
                <p className="text-xs text-gray-500 mt-2 leading-relaxed">{t('settings.sources.manualHint')}</p>
                <div className="flex justify-end mt-3">
                  <PrimaryButton type="submit" disabled={isSavingManual}>
                    {isSavingManual && <Loader2 className="w-5 h-5 animate-spin" />}
                    {isSavingManual ? t('settings.sources.saving') : t('settings.sources.saveManual')}
                  </PrimaryButton>
                </div>
                {manualSaveError && (
                  <p className="text-sm text-orange-400 mt-3 leading-relaxed">{manualSaveError}</p>
                )}
              </div>
            )}
          </div>
        </form>
      </div>
    </div>
  );
};
