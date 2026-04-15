import React, { useState, useEffect, useCallback } from 'react';
import clsx from 'clsx';
import {
  Copy, FolderOpen, Check, Loader2, Link2, Shield,
  RefreshCw, AlertTriangle, X, ChevronDown, ExternalLink, Plus, Trash2,
  Layers, Activity,
} from 'lucide-react';
import { ConnectionMode, DEFAULT_PERFORMANCE_SETTINGS, DomainStrategy, LogLevel, PerformanceSettings, Subscription, TlsFingerprint, VlessConfig, XudpProxyUDP443 } from '../../shared/types';
import { YANDEX_TRANSLATED_MOBILE_LIST_URL } from '../../shared/subscriptionUrls';
import { useTranslation } from 'react-i18next';
import { useSettingsMonitor } from '../hooks/useSettingsMonitor';

interface SettingsModalProps {
  isOpen: boolean;
  servers: VlessConfig[];
  subscriptions: Subscription[];
  onClose: () => void;
}

type SettingsTabId = 'sources' | 'network' | 'diagnostics';

const SETTINGS_TABS: { id: SettingsTabId; labelKey: string; icon: typeof Layers }[] = [
  { id: 'sources', labelKey: 'settings.tabs.sources', icon: Layers },
  { id: 'network', labelKey: 'settings.tabs.network', icon: Shield },
  { id: 'diagnostics', labelKey: 'settings.tabs.diagnostics', icon: Activity },
];

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, servers, subscriptions, onClose }) => {
  const { t, i18n } = useTranslation();
  const [activeTab, setActiveTab] = useState<SettingsTabId>('sources');
  // ---- Manual links ----
  const [manualLinks, setManualLinks] = useState('');
  const [isManualExpanded, setIsManualExpanded] = useState(false);
  const [manualSaveError, setManualSaveError] = useState<string | null>(null);
  const [isSavingManual, setIsSavingManual] = useState(false);

  // ---- Add subscription form ----
  const [isAddFormExpanded, setIsAddFormExpanded] = useState(false);
  const [newSubName, setNewSubName] = useState('');
  const [newSubUrl, setNewSubUrl] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);

  // ---- Mobile import ----
  const [importingMobileList, setImportingMobileList] = useState(false);
  const [importMobileError, setImportMobileError] = useState<string | null>(null);

  // ---- Performance settings ----
  const [perfSettings, setPerfSettings] = useState<PerformanceSettings>(DEFAULT_PERFORMANCE_SETTINGS);
  const [perfDirty, setPerfDirty] = useState(false);
  const [perfSaving, setPerfSaving] = useState(false);

  // ---- Connection / mode ----
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [modeError, setModeError] = useState<string | null>(null);
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>('proxy');
  const [tunCapability, setTunCapability] = useState<import('../../shared/ipc').TunCapabilityStatus | null>(null);
  const {
    monitorStatus,
    recentEvents,
    autoSwitching,
    setAutoSwitching,
    loadMonitorStatus,
  } = useSettingsMonitor({ isOpen });

  useEffect(() => {
    if (!isOpen) return;
    setCopyError(null);
    setManualSaveError(null);
    setModeError(null);
    setImportMobileError(null);
    setAddError(null);

    window.electronAPI.getManualLinks().then((links) => {
      setManualLinks(links || '');
    }).catch(err => {
      console.error('Failed to load manual links:', err);
    });

    window.electronAPI.getConnectionMode().then((mode) => {
      setConnectionMode(mode);
    }).catch(err => {
      console.error('Failed to load connection mode:', err);
    });

    window.electronAPI.getPerformanceSettings().then((settings) => {
      setPerfSettings(settings);
      setPerfDirty(false);
    }).catch(err => {
      console.error('Failed to load performance settings:', err);
    });

    window.electronAPI.getTunCapabilityStatus().then((status) => {
      setTunCapability(status);
    }).catch(err => {
      console.error('Failed to load TUN capability status:', err);
    });

  }, [isOpen]);

  // ---- Subscription actions ----

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
    if (!name) { setAddError('Name is required'); return; }
    if (!url) { setAddError('URL is required'); return; }

    setIsAdding(true);
    try {
      const result = await window.electronAPI.addSubscription({ name, url });
      if (!result.ok) {
        setAddError(result.error || 'Failed to fetch subscription');
      } else {
        setNewSubName('');
        setNewSubUrl('');
        setIsAddFormExpanded(false);
      }
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Failed to add subscription');
    } finally {
      setIsAdding(false);
    }
  }, [newSubName, newSubUrl]);

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
        setImportMobileError(data.error || 'Could not load configs.');
      }
    } finally {
      setImportingMobileList(false);
    }
  }, []);

  // ---- Manual links save ----

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
      setManualSaveError(err instanceof Error ? err.message : 'Failed to save manual links');
    } finally {
      setIsSavingManual(false);
    }
  }, [manualLinks]);

  // ---- Connection mode ----

  const handleToggleAutoSwitching = useCallback(async (enabled: boolean) => {
    try {
      await window.electronAPI.setAutoSwitching(enabled);
      setAutoSwitching(enabled);
    } catch (err) {
      console.error('Failed to toggle auto-switching:', err);
    }
  }, [setAutoSwitching]);

  const handleConnectionModeChange = useCallback(async (mode: ConnectionMode) => {
    if (monitorStatus?.isConnected) {
      setModeError(t('settings.network.disconnectHintError'));
      return;
    }
    if (mode === 'tun') {
      if (tunCapability && !tunCapability.supported) {
        setModeError(tunCapability.platform === 'darwin' ? t('settings.network.tunUnsupportedDarwin') : t('settings.network.tunUnavailable'));
        return;
      }
    }
    try {
      await window.electronAPI.setConnectionMode(mode);
      setConnectionMode(mode);
      setModeError(null);
    } catch (err) {
      console.error('Failed to set connection mode:', err);
      setModeError(err instanceof Error ? err.message : 'Failed to set connection mode');
    }
  }, [monitorStatus?.isConnected, tunCapability, t]);

  const tunUnavailable = !!tunCapability && !tunCapability.supported;
  const tunNeedsPrivileges = !!tunCapability && tunCapability.supported && !tunCapability.hasPrivileges;
  const tunButtonDisabled = tunUnavailable;
  const modeLockedByConnection = !!monitorStatus?.isConnected;
  const xrayStateLabel = monitorStatus?.xrayState ? monitorStatus.xrayState.replace(/^\w/, (v) => v.toUpperCase()) : null;
  const healthStateLabel = monitorStatus?.lastHealthState ? monitorStatus.lastHealthState.replace(/^\w/, (v) => v.toUpperCase()) : null;
  const formatTimestamp = (value: number | null | undefined) => (value ? new Date(value).toLocaleTimeString() : 'n/a');

  const updatePerfField = useCallback(<K extends keyof PerformanceSettings>(key: K, value: PerformanceSettings[K]) => {
    setPerfSettings(prev => ({ ...prev, [key]: value }));
    setPerfDirty(true);
  }, []);

  const handleSavePerfSettings = useCallback(async () => {
    setPerfSaving(true);
    try {
      await window.electronAPI.setPerformanceSettings(perfSettings);
      setPerfDirty(false);
    } catch (err) {
      console.error('Failed to save performance settings:', err);
    } finally {
      setPerfSaving(false);
    }
  }, [perfSettings]);

  const handleResetPerfDefaults = useCallback(async () => {
    setPerfSettings(DEFAULT_PERFORMANCE_SETTINGS);
    setPerfSaving(true);
    try {
      await window.electronAPI.setPerformanceSettings(DEFAULT_PERFORMANCE_SETTINGS);
      setPerfDirty(false);
    } catch (err) {
      console.error('Failed to reset performance settings:', err);
      setPerfDirty(true);
    } finally {
      setPerfSaving(false);
    }
  }, []);

  const handleClearBlocked = useCallback(async () => {
    try {
      await window.electronAPI.clearBlockedServers();
      loadMonitorStatus();
    } catch (err) {
      console.error('Failed to clear blocked servers:', err);
    }
  }, [loadMonitorStatus]);

  const handleCopyLogs = useCallback(async () => {
    setCopyError(null);
    try {
      const logs = await window.electronAPI.getLogs();
      await navigator.clipboard.writeText(logs);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy logs', error);
      setCopyError('Failed to copy logs to clipboard.');
      setCopied(false);
    }
  }, []);

  const handleOpenFolder = useCallback(() => {
    void window.electronAPI.openLogFolder().catch((error) => {
      console.error('Failed to open log folder', error);
    });
  }, []);

  if (!isOpen) return null;

  return (
    <div className="flex-1 flex flex-col items-stretch sm:items-center justify-center p-3 sm:p-4 md:p-6 animate-[fadeIn_0.3s_ease-out] min-h-0 min-w-0 overflow-hidden">
      <div className="w-full max-w-2xl max-h-[min(85dvh,760px)] min-h-0 bg-gradient-to-br from-surface via-surface to-surface/95 backdrop-blur-xl rounded-2xl border border-gray-700/50 shadow-2xl shadow-black/50 relative overflow-hidden flex flex-col mx-auto">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent pointer-events-none z-0" />

        <header className="relative z-10 shrink-0 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between px-4 sm:px-6 pt-4 sm:pt-5 pb-3 border-b border-gray-800/50">
          <div className="min-w-0">
            <h2 className="text-lg sm:text-xl font-semibold text-white tracking-tight">{t('settings.title')}</h2>
            <p className="text-xs text-gray-400 mt-1 leading-relaxed max-w-md">{t('settings.subtitle')}</p>
          </div>
          <div className="flex items-center gap-2 self-end sm:self-center mt-2 sm:mt-0">
            <div className="flex bg-black/40 border border-gray-700/50 rounded-xl p-1">
              <button
                type="button"
                onClick={() => i18n.changeLanguage('ru')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${i18n.language === 'ru' ? 'bg-primary/20 text-white' : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'}`}
              >
                RU
              </button>
              <button
                type="button"
                onClick={() => i18n.changeLanguage('en')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${i18n.language.startsWith('en') ? 'bg-primary/20 text-white' : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'}`}
              >
                EN
              </button>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl p-2.5 text-gray-400 hover:text-white hover:bg-white/5 border border-transparent hover:border-gray-700/50 transition-colors"
              aria-label="Close settings"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </header>

        <nav
          className="relative z-10 shrink-0 px-3 sm:px-6 py-2 flex gap-1.5 overflow-x-auto"
          role="tablist"
          aria-label="Settings sections"
        >
          {SETTINGS_TABS.map(({ id, labelKey, icon: Icon }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={activeTab === id}
              onClick={() => setActiveTab(id)}
              className={clsx(
                'shrink-0 flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-colors border border-transparent whitespace-nowrap',
                activeTab === id
                  ? 'bg-primary/15 text-white border-primary/30'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'
              )}
            >
              <Icon className="w-4 h-4 opacity-90" />
              {t(labelKey)}
            </button>
          ))}
        </nav>

        <div className="flex-1 min-h-0 overflow-y-auto relative z-10 px-4 sm:px-6 py-4 sm:py-5 pb-6 text-sm leading-relaxed">
          {activeTab === 'sources' && (
          <div className="space-y-6">
            <div>
            <p className="text-sm font-medium text-gray-300 mb-3">{t('settings.sources.subscriptions')}</p>
            {/* Subscription list */}
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
                  {/* Enabled toggle */}
                  <button
                    type="button"
                    onClick={() => handleToggleSubscription(sub)}
                    className={`relative w-10 h-5 rounded-full transition-colors duration-200 flex-shrink-0 focus:outline-none focus:ring-2 focus:ring-primary/50 ${sub.enabled ? 'bg-primary' : 'bg-gray-700'}`}
                    title={sub.enabled ? 'Disable subscription' : 'Enable subscription'}
                  >
                    <div
                      className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform duration-200 ${sub.enabled ? 'translate-x-5' : 'translate-x-0'}`}
                    />
                  </button>
                  {/* Delete */}
                  <button
                    type="button"
                    onClick={() => handleDeleteSubscription(sub.id)}
                    className="p-1.5 rounded-lg text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-colors flex-shrink-0"
                    title="Remove subscription"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Add subscription form */}
            <div className="rounded-2xl border border-gray-700/50 bg-gray-900/20 overflow-hidden mb-1">
              <button
                type="button"
                onClick={() => { setIsAddFormExpanded((p) => !p); setAddError(null); }}
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
                  <button
                    type="submit"
                    disabled={isAdding}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold bg-gradient-to-r from-primary to-blue-600 text-white hover:from-blue-500 hover:to-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                  >
                    {isAdding ? <Loader2 className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />}
                    {isAdding ? t('settings.sources.adding') : t('settings.sources.addAndFetch')}
                  </button>
                </form>
              )}
            </div>

            {/* Mobile whitelist import */}
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
                      <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-primary/0 via-primary/5 to-primary/0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />
                    </div>
                    <p className="text-xs text-gray-500 mt-2 leading-relaxed">{t('settings.sources.manualHint')}</p>
                    <div className="flex justify-end mt-3">
                      <button
                        type="submit"
                        disabled={isSavingManual}
                        className="px-4 py-2 bg-gradient-to-r from-primary to-blue-600 rounded-lg text-white text-sm font-semibold hover:from-blue-500 hover:to-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-all"
                      >
                        {isSavingManual && <Loader2 className="w-5 h-5 animate-spin" />}
                        {isSavingManual ? t('settings.sources.saving') : t('settings.sources.saveManual')}
                      </button>
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
          )}

          {activeTab === 'network' && (
          <div className="space-y-4">
            <div className="flex items-center gap-2.5 mb-1">
              <Shield className="w-4 h-4 text-primary shrink-0" />
              <h3 className="text-sm font-semibold text-gray-200">{t('settings.network.mode')}</h3>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => handleConnectionModeChange('proxy')}
                disabled={modeLockedByConnection}
                className={`p-4 rounded-xl border text-left transition-all duration-200 ${
                  connectionMode === 'proxy'
                    ? 'border-primary/70 bg-primary/10 text-white'
                    : modeLockedByConnection
                    ? 'border-gray-800/80 bg-gray-900/30 text-gray-500 cursor-not-allowed opacity-70'
                    : 'border-gray-700/50 bg-gray-800/40 text-gray-300 hover:border-gray-600/70'
                }`}
              >
                <div className="text-sm font-semibold mb-1">{t('settings.network.proxyMode')}</div>
                <div className="text-xs text-gray-400 leading-relaxed">{t('settings.network.proxyDesc')}</div>
              </button>
              <button
                type="button"
                onClick={() => handleConnectionModeChange('tun')}
                disabled={tunButtonDisabled || modeLockedByConnection}
                className={`p-4 rounded-xl border text-left transition-all duration-200 ${
                  connectionMode === 'tun'
                    ? 'border-primary/70 bg-primary/10 text-white'
                    : tunButtonDisabled || modeLockedByConnection
                    ? 'border-gray-800/80 bg-gray-900/30 text-gray-500 cursor-not-allowed opacity-70'
                    : 'border-gray-700/50 bg-gray-800/40 text-gray-300 hover:border-gray-600/70'
                }`}
              >
                <div className="text-sm font-semibold mb-1">{t('settings.network.tunMode')}</div>
                <div className="text-xs text-gray-400 leading-relaxed">{t('settings.network.tunDesc')}</div>
              </button>
            </div>

            <p className="text-sm text-gray-500 leading-relaxed">{t('settings.network.disconnectHint')}</p>
            {tunUnavailable && (
              <p className="text-sm text-orange-400 leading-relaxed">
                {tunCapability?.platform === 'darwin' ? t('settings.network.tunUnsupportedDarwin') : t('settings.network.tunUnavailable')}
              </p>
            )}
            {tunNeedsPrivileges && (
              <p className="text-sm text-orange-400 leading-relaxed">
                {tunCapability?.platform === 'win32' ? t('settings.network.tunElevated_win32') : t('settings.network.tunElevated')}
              </p>
            )}
            {tunCapability?.routeMode && (
              <p className="text-sm text-gray-500 leading-relaxed">{t('settings.network.routingMode', { mode: tunCapability.routeMode })}</p>
            )}
            {tunCapability?.degradedReason && (
              <p className="text-sm text-orange-400 leading-relaxed">
                {tunCapability.platform === 'linux' ? t('settings.network.tunDegradedLinux') : tunCapability.degradedReason}
              </p>
            )}
            {modeError && <p className="text-sm text-orange-400 leading-relaxed">{modeError}</p>}

            {/* Performance tuning */}
            <div className="mt-6 pt-6 border-t border-gray-700/50 space-y-4">
              <div className="flex items-center gap-2.5 mb-1">
                <Activity className="w-4 h-4 text-primary shrink-0" />
                <h3 className="text-sm font-semibold text-gray-200">{t('settings.network.performance')}</h3>
              </div>
              <p className="text-xs text-gray-500 leading-relaxed">{t('settings.network.performanceHint')}</p>

              <div className="space-y-3">
                {/* TCP Mux toggle */}
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm text-gray-200">{t('settings.network.muxEnabled')}</div>
                    <div className="text-xs text-gray-500 leading-relaxed mt-0.5">{t('settings.network.muxEnabledHint')}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => updatePerfField('muxEnabled', !perfSettings.muxEnabled)}
                    className={`relative w-10 h-5 rounded-full transition-colors duration-200 flex-shrink-0 ${perfSettings.muxEnabled ? 'bg-primary' : 'bg-gray-700'}`}
                  >
                    <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform duration-200 ${perfSettings.muxEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
                  </button>
                </div>

                {/* Mux concurrency */}
                {perfSettings.muxEnabled && (
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm text-gray-200">{t('settings.network.muxConcurrency')}</div>
                    <div className="text-xs text-gray-500 leading-relaxed mt-0.5">{t('settings.network.muxConcurrencyHint')}</div>
                  </div>
                  <input
                    type="number"
                    min={1}
                    max={128}
                    value={perfSettings.muxConcurrency}
                    onChange={e => updatePerfField('muxConcurrency', Math.max(1, Math.min(128, parseInt(e.target.value) || 1)))}
                    className="w-20 bg-black/40 border border-gray-600/50 rounded-lg px-2 py-1.5 text-sm text-white text-center focus:border-primary/60 focus:ring-1 focus:ring-primary/20 outline-none"
                  />
                </div>
                )}

                {/* XUDP concurrency */}
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm text-gray-200">{t('settings.network.xudpConcurrency')}</div>
                    <div className="text-xs text-gray-500 leading-relaxed mt-0.5">{t('settings.network.xudpConcurrencyHint')}</div>
                  </div>
                  <input
                    type="number"
                    min={1}
                    max={1024}
                    value={perfSettings.xudpConcurrency}
                    onChange={e => updatePerfField('xudpConcurrency', Math.max(1, Math.min(1024, parseInt(e.target.value) || 1)))}
                    className="w-20 bg-black/40 border border-gray-600/50 rounded-lg px-2 py-1.5 text-sm text-white text-center focus:border-primary/60 focus:ring-1 focus:ring-primary/20 outline-none"
                  />
                </div>

                {/* xudpProxyUDP443 */}
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm text-gray-200">{t('settings.network.xudpProxyUDP443')}</div>
                    <div className="text-xs text-gray-500 leading-relaxed mt-0.5">{t('settings.network.xudpProxyUDP443Hint')}</div>
                  </div>
                  <select
                    value={perfSettings.xudpProxyUDP443}
                    onChange={e => updatePerfField('xudpProxyUDP443', e.target.value as XudpProxyUDP443)}
                    className="bg-black/40 border border-gray-600/50 rounded-lg px-2 py-1.5 text-sm text-white focus:border-primary/60 focus:ring-1 focus:ring-primary/20 outline-none"
                  >
                    <option value="reject">{t('settings.network.udp443Reject')}</option>
                    <option value="allow">{t('settings.network.udp443Allow')}</option>
                    <option value="skip">{t('settings.network.udp443Skip')}</option>
                  </select>
                </div>

                {/* TCP Fast Open */}
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm text-gray-200">{t('settings.network.tcpFastOpen')}</div>
                    <div className="text-xs text-gray-500 leading-relaxed mt-0.5">{t('settings.network.tcpFastOpenHint')}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => updatePerfField('tcpFastOpen', !perfSettings.tcpFastOpen)}
                    className={`relative w-10 h-5 rounded-full transition-colors duration-200 flex-shrink-0 ${perfSettings.tcpFastOpen ? 'bg-primary' : 'bg-gray-700'}`}
                  >
                    <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform duration-200 ${perfSettings.tcpFastOpen ? 'translate-x-5' : 'translate-x-0'}`} />
                  </button>
                </div>

                {/* Sniffing route-only */}
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm text-gray-200">{t('settings.network.sniffingRouteOnly')}</div>
                    <div className="text-xs text-gray-500 leading-relaxed mt-0.5">{t('settings.network.sniffingRouteOnlyHint')}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => updatePerfField('sniffingRouteOnly', !perfSettings.sniffingRouteOnly)}
                    className={`relative w-10 h-5 rounded-full transition-colors duration-200 flex-shrink-0 ${perfSettings.sniffingRouteOnly ? 'bg-primary' : 'bg-gray-700'}`}
                  >
                    <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform duration-200 ${perfSettings.sniffingRouteOnly ? 'translate-x-5' : 'translate-x-0'}`} />
                  </button>
                </div>

                <div className="border-t border-gray-700/40 my-1" />

                {/* Log level */}
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm text-gray-200">{t('settings.network.logLevel')}</div>
                    <div className="text-xs text-gray-500 leading-relaxed mt-0.5">{t('settings.network.logLevelHint')}</div>
                  </div>
                  <select
                    value={perfSettings.logLevel}
                    onChange={e => updatePerfField('logLevel', e.target.value as LogLevel)}
                    className="bg-black/40 border border-gray-600/50 rounded-lg px-2 py-1.5 text-sm text-white focus:border-primary/60 focus:ring-1 focus:ring-primary/20 outline-none"
                  >
                    <option value="debug">debug</option>
                    <option value="info">info</option>
                    <option value="warning">warning</option>
                    <option value="error">error</option>
                    <option value="none">none</option>
                  </select>
                </div>

                {/* TLS fingerprint */}
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm text-gray-200">{t('settings.network.fingerprint')}</div>
                    <div className="text-xs text-gray-500 leading-relaxed mt-0.5">{t('settings.network.fingerprintHint')}</div>
                  </div>
                  <select
                    value={perfSettings.fingerprint}
                    onChange={e => updatePerfField('fingerprint', e.target.value as TlsFingerprint)}
                    className="bg-black/40 border border-gray-600/50 rounded-lg px-2 py-1.5 text-sm text-white focus:border-primary/60 focus:ring-1 focus:ring-primary/20 outline-none"
                  >
                    <option value="chrome">Chrome</option>
                    <option value="firefox">Firefox</option>
                    <option value="safari">Safari</option>
                    <option value="edge">Edge</option>
                    <option value="random">Random</option>
                    <option value="randomized">Randomized</option>
                  </select>
                </div>

                {/* Block ads */}
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm text-gray-200">{t('settings.network.blockAds')}</div>
                    <div className="text-xs text-gray-500 leading-relaxed mt-0.5">{t('settings.network.blockAdsHint')}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => updatePerfField('blockAds', !perfSettings.blockAds)}
                    className={`relative w-10 h-5 rounded-full transition-colors duration-200 flex-shrink-0 ${perfSettings.blockAds ? 'bg-primary' : 'bg-gray-700'}`}
                  >
                    <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform duration-200 ${perfSettings.blockAds ? 'translate-x-5' : 'translate-x-0'}`} />
                  </button>
                </div>

                {/* Block BitTorrent */}
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm text-gray-200">{t('settings.network.blockBittorrent')}</div>
                    <div className="text-xs text-gray-500 leading-relaxed mt-0.5">{t('settings.network.blockBittorrentHint')}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => updatePerfField('blockBittorrent', !perfSettings.blockBittorrent)}
                    className={`relative w-10 h-5 rounded-full transition-colors duration-200 flex-shrink-0 ${perfSettings.blockBittorrent ? 'bg-primary' : 'bg-gray-700'}`}
                  >
                    <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform duration-200 ${perfSettings.blockBittorrent ? 'translate-x-5' : 'translate-x-0'}`} />
                  </button>
                </div>

                {/* Domain strategy */}
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm text-gray-200">{t('settings.network.domainStrategy')}</div>
                    <div className="text-xs text-gray-500 leading-relaxed mt-0.5">{t('settings.network.domainStrategyHint')}</div>
                  </div>
                  <select
                    value={perfSettings.domainStrategy}
                    onChange={e => updatePerfField('domainStrategy', e.target.value as DomainStrategy)}
                    className="bg-black/40 border border-gray-600/50 rounded-lg px-2 py-1.5 text-sm text-white focus:border-primary/60 focus:ring-1 focus:ring-primary/20 outline-none"
                  >
                    <option value="AsIs">AsIs</option>
                    <option value="IPIfNonMatch">IPIfNonMatch</option>
                    <option value="IPOnDemand">IPOnDemand</option>
                  </select>
                </div>
              </div>

              {/* Save / Reset buttons */}
              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleSavePerfSettings}
                  disabled={!perfDirty || perfSaving}
                  className="flex-1 px-4 py-2 bg-gradient-to-r from-primary to-blue-600 rounded-lg text-white text-sm font-semibold hover:from-blue-500 hover:to-blue-700 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-all"
                >
                  {perfSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                  {perfDirty ? (perfSaving ? t('settings.sources.saving') : t('settings.sources.saveManual')) : <Check className="w-4 h-4" />}
                </button>
                <button
                  type="button"
                  onClick={handleResetPerfDefaults}
                  disabled={perfSaving}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-gray-400 border border-gray-700/50 hover:text-gray-200 hover:border-gray-600/70 hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {t('settings.network.resetDefaults')}
                </button>
              </div>
            </div>
          </div>
          )}

          {activeTab === 'diagnostics' && (
          <div className="space-y-6">
            <div className="flex items-center gap-2.5 mb-1">
              <RefreshCw className="w-4 h-4 text-primary shrink-0" />
              <h3 className="text-sm font-semibold text-gray-200">{t('settings.diagnostics.monitoring')}</h3>
            </div>

            <div className="mb-2 p-4 rounded-xl bg-gradient-to-br from-gray-800/50 to-gray-800/30 border border-gray-700/50">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-white mb-1">{t('settings.diagnostics.autoSwitching')}</div>
                  <div className="text-xs text-gray-400 leading-relaxed">{t('settings.diagnostics.autoSwitchingDesc')}</div>
                </div>
                <button
                  onClick={() => handleToggleAutoSwitching(!autoSwitching)}
                  className={`relative w-12 h-6 rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-primary/50 ${autoSwitching ? 'bg-primary' : 'bg-gray-700'}`}
                >
                  <div className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform duration-200 ${autoSwitching ? 'translate-x-6' : 'translate-x-0'}`} />
                </button>
              </div>

              {monitorStatus && (
                <div className="mt-4 pt-4 border-t border-gray-700/50 space-y-3">
                  {monitorStatus.isConnected && monitorStatus.currentServer && (
                    <div className="flex items-center justify-between text-sm gap-3">
                      <span className="text-gray-400">{t('settings.diagnostics.currentServer')}</span>
                      <span className="text-white font-medium text-right truncate">{monitorStatus.currentServer.name}</span>
                    </div>
                  )}
                  {monitorStatus.blockedServers.length > 0 && (
                    <div className="flex items-center justify-between text-sm gap-3">
                      <span className="text-gray-400">{t('settings.diagnostics.blockedServers')}</span>
                      <span className="text-orange-400 font-medium">{monitorStatus.blockedServers.length}</span>
                    </div>
                  )}
                  {monitorStatus.lastError && (
                    <div className="flex items-start gap-2.5 text-sm">
                      <AlertTriangle className="w-4 h-4 text-orange-400 mt-0.5 flex-shrink-0" />
                      <span className="text-gray-400 flex-1 min-w-0 break-words" title={monitorStatus.lastError}>
                        {t('settings.diagnostics.lastError')}: {monitorStatus.lastError}
                      </span>
                    </div>
                  )}
                  {xrayStateLabel && (
                    <div className="flex items-center justify-between text-sm gap-3">
                      <span className="text-gray-400">{t('settings.diagnostics.xrayState')}</span>
                      <span className={monitorStatus.xrayRunning ? 'text-green-400 font-medium' : 'text-gray-300 font-medium'}>
                        {xrayStateLabel}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center justify-between text-sm gap-3">
                    <span className="text-gray-400">{t('settings.diagnostics.lastHealthCheck')}</span>
                    <span className="text-gray-300">{formatTimestamp(monitorStatus.lastHealthCheckAt)}</span>
                  </div>
                  {healthStateLabel && (
                    <div className="flex items-center justify-between text-sm gap-3">
                      <span className="text-gray-400">{t('settings.diagnostics.healthState')}</span>
                      <span className="text-gray-300">{healthStateLabel}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between text-sm gap-3">
                    <span className="text-gray-400">{t('settings.diagnostics.localProxy')}</span>
                    <span className="text-gray-300">
                      {monitorStatus.localProxyReachable == null ? 'n/a' : monitorStatus.localProxyReachable ? 'yes' : 'no'}
                    </span>
                  </div>
                  {(monitorStatus.lastHealthFailureReason || monitorStatus.xrayLastFailureReason || monitorStatus.recoveryInProgress || monitorStatus.recoveryBlocked || monitorStatus.lastFatalReason) && (
                    <div className="space-y-2 pt-2">
                      {monitorStatus.lastHealthFailureReason && (
                        <div className="flex items-start gap-2.5 text-sm">
                          <AlertTriangle className="w-4 h-4 text-orange-400 mt-0.5 flex-shrink-0" />
                          <span className="text-gray-400 flex-1 min-w-0 break-words" title={monitorStatus.lastHealthFailureReason}>
                            {t('settings.diagnostics.healthFailure')}: {monitorStatus.lastHealthFailureReason}
                          </span>
                        </div>
                      )}
                      {monitorStatus.xrayLastFailureReason && (
                        <div className="flex items-start gap-2.5 text-sm">
                          <AlertTriangle className="w-4 h-4 text-orange-400 mt-0.5 flex-shrink-0" />
                          <span className="text-gray-400 flex-1 min-w-0 break-words" title={monitorStatus.xrayLastFailureReason}>
                            {t('settings.diagnostics.xrayFailure')}: {monitorStatus.xrayLastFailureReason}
                          </span>
                        </div>
                      )}
                      {(monitorStatus.recoveryInProgress || monitorStatus.recoveryBlocked) && (
                        <div className="flex items-start gap-2.5 text-sm">
                          <RefreshCw className={`w-4 h-4 mt-0.5 flex-shrink-0 ${monitorStatus.recoveryInProgress ? 'text-blue-400 animate-spin' : 'text-orange-400'}`} />
                          <span className="text-gray-400 flex-1 leading-relaxed">
                            {monitorStatus.recoveryInProgress
                              ? t('settings.diagnostics.recoveryInProgress', { count: monitorStatus.recoveryAttemptCount })
                              : t('settings.diagnostics.recoveryPaused', { count: monitorStatus.recoveryAttemptCount })}
                            {monitorStatus.lastRecoveryTrigger ? ` via ${monitorStatus.lastRecoveryTrigger}` : ''}
                            {monitorStatus.lastRecoveryReason ? `: ${monitorStatus.lastRecoveryReason}` : ''}
                          </span>
                        </div>
                      )}
                      {monitorStatus.lastFatalReason && (
                        <div className="flex items-start gap-2.5 text-sm">
                          <X className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
                          <span className="text-gray-400 flex-1 min-w-0 break-words" title={monitorStatus.lastFatalReason}>
                            {t('settings.diagnostics.lastFatal')}: {monitorStatus.lastFatalReason}
                          </span>
                        </div>
                      )}
                      <div className="flex items-center justify-between text-sm gap-3">
                        <span className="text-gray-400">{t('settings.diagnostics.lastRecovery')}</span>
                        <span className="text-gray-300">{formatTimestamp(monitorStatus.lastRecoveryAt)}</span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {monitorStatus && monitorStatus.blockedServers.length > 0 && (
                <div className="mt-4 pt-4 border-t border-gray-700/50">
                  <div className="flex items-center justify-between mb-3 gap-2">
                    <span className="text-sm text-gray-400">{t('settings.diagnostics.blockedServers')} ({monitorStatus.blockedServers.length})</span>
                    <button
                      type="button"
                      onClick={handleClearBlocked}
                      className="text-sm text-primary hover:text-blue-400 transition-colors flex items-center gap-1.5 shrink-0"
                    >
                      <X className="w-4 h-4" />
                      {t('settings.diagnostics.clear')}
                    </button>
                  </div>
                  <div className="space-y-2 max-h-28 overflow-y-auto">
                    {monitorStatus.blockedServers.map((serverId) => {
                      const server = servers.find(s => s.uuid === serverId);
                      const serverName = server?.name
                        ?? (monitorStatus.currentServer?.uuid === serverId
                          ? monitorStatus.currentServer.name
                          : `Server ${serverId.substring(0, 8)}...`);
                      return (
                        <div key={serverId} className="text-sm text-orange-400 bg-orange-500/10 px-3 py-1.5 rounded-lg border border-orange-500/20 truncate">
                          {serverName}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {recentEvents.length > 0 && (
              <div className="mb-2 p-4 rounded-xl bg-gradient-to-br from-gray-800/50 to-gray-800/30 border border-gray-700/50">
                <div className="text-xs font-medium text-gray-300 mb-2">Recent events</div>
                <div className="space-y-2 max-h-32 overflow-y-auto">
                  {recentEvents.map((event, idx) => (
                    <div key={idx} className="text-sm p-3 rounded-xl bg-gray-900/50 border border-gray-700/30">
                      <div className="flex items-start gap-2.5">
                        {event.type === 'error' && <AlertTriangle className="w-4 h-4 text-orange-400 shrink-0 mt-0.5" />}
                        {event.type === 'blocked' && <X className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />}
                        {event.type === 'switching' && <RefreshCw className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />}
                        {event.type === 'connected' && <Check className="w-4 h-4 text-green-400 shrink-0 mt-0.5" />}
                        <span className="text-gray-300 flex-1 min-w-0 leading-relaxed">{event.message || event.type}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

          <div>
            <div className="flex items-center gap-2.5 mb-3">
              <Shield className="w-4 h-4 text-gray-400 shrink-0" />
              <h3 className="text-sm font-semibold text-gray-200">{t('settings.diagnostics.troubleshooting')}</h3>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={handleCopyLogs}
                className="group flex flex-col items-center justify-center gap-2.5 p-4 rounded-xl bg-gradient-to-br from-gray-800/50 to-gray-800/30 hover:from-gray-700/60 hover:to-gray-700/40 transition-all duration-200 border border-gray-700/50 hover:border-gray-600/70 hover:shadow-lg hover:shadow-black/20 transform hover:scale-[1.02] active:scale-[0.98]"
              >
                <div className={`p-2 rounded-lg ${copied ? 'bg-green-500/20' : 'bg-gray-700/50 group-hover:bg-gray-600/50'} transition-all duration-200`}>
                  {copied ? (
                    <Check className="w-5 h-5 text-green-400" />
                  ) : (
                    <Copy className="w-5 h-5 text-gray-300 group-hover:text-white transition-colors" />
                  )}
                </div>
                <span className={`text-sm font-medium ${copied ? 'text-green-400' : 'text-gray-300 group-hover:text-white'} transition-colors`}>
                  {copied ? t('settings.diagnostics.copied') : t('settings.diagnostics.copyLogs')}
                </span>
              </button>

              <button
                type="button"
                onClick={handleOpenFolder}
                className="group flex flex-col items-center justify-center gap-2.5 p-4 rounded-xl bg-gradient-to-br from-gray-800/50 to-gray-800/30 hover:from-gray-700/60 hover:to-gray-700/40 transition-all duration-200 border border-gray-700/50 hover:border-gray-600/70 hover:shadow-lg hover:shadow-black/20 transform hover:scale-[1.02] active:scale-[0.98]"
              >
                <div className="p-2 rounded-lg bg-gray-700/50 group-hover:bg-gray-600/50 transition-all duration-200">
                  <FolderOpen className="w-5 h-5 text-gray-300 group-hover:text-white transition-colors" />
                </div>
                <span className="text-sm font-medium text-gray-300 group-hover:text-white transition-colors">
                  {t('settings.diagnostics.openFolder')}
                </span>
              </button>
            </div>

            <div className="mt-4 p-3 rounded-lg bg-gray-800/30 border border-gray-700/30">
              <p className="text-xs text-gray-500 text-center leading-relaxed">
                <Shield className="w-3.5 h-3.5 inline-block mr-1.5 mb-0.5 align-text-bottom opacity-80" />
                {t('settings.diagnostics.sanitizedHint')}
              </p>
              {copyError && (
                <p className="text-sm text-orange-400 text-center mt-3 leading-relaxed">{copyError}</p>
              )}
            </div>
          </div>
          </div>
          )}
        </div>
      </div>
    </div>
  );
};
