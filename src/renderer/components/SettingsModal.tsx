import React, { useState, useEffect, useCallback, useRef } from 'react';
import clsx from 'clsx';
import {
  Copy, FolderOpen, Check, Loader2, Link2, Shield,
  RefreshCw, AlertTriangle, X, ChevronDown, ExternalLink, Plus, Trash2,
  Layers, Activity,
} from 'lucide-react';
import { ConnectionStatus as MonitorStatus, ConnectionMonitorEvent } from '../preload.d';
import { ConnectionMode, Subscription, VlessConfig } from '../../shared/types';
import { YANDEX_TRANSLATED_MOBILE_LIST_URL } from '../../shared/subscriptionUrls';

interface SettingsModalProps {
  isOpen: boolean;
  servers: VlessConfig[];
  subscriptions: Subscription[];
  onClose: () => void;
}

type SettingsTabId = 'sources' | 'network' | 'diagnostics';

const SETTINGS_TABS: { id: SettingsTabId; label: string; icon: typeof Layers }[] = [
  { id: 'sources', label: 'Sources', icon: Layers },
  { id: 'network', label: 'Network', icon: Shield },
  { id: 'diagnostics', label: 'Diagnostics', icon: Activity },
];

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, servers, subscriptions, onClose }) => {
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

  // ---- Connection / mode ----
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [modeError, setModeError] = useState<string | null>(null);
  const [autoSwitching, setAutoSwitching] = useState(true);
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>('proxy');
  const [tunCapability, setTunCapability] = useState<import('../../shared/ipc').TunCapabilityStatus | null>(null);
  const [monitorStatus, setMonitorStatus] = useState<MonitorStatus | null>(null);
  const [recentEvents, setRecentEvents] = useState<ConnectionMonitorEvent[]>([]);

  const loadMonitorStatusRef = useRef<(() => Promise<void>) | null>(null);

  const loadMonitorStatus = useCallback(async () => {
    try {
      const status = await window.electronAPI.getConnectionMonitorStatus();
      setMonitorStatus(status);
      setAutoSwitching(status.autoSwitchingEnabled ?? true);
    } catch (err) {
      console.error('Failed to load monitor status:', err);
    }
  }, []);

  loadMonitorStatusRef.current = loadMonitorStatus;

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

    window.electronAPI.getTunCapabilityStatus().then((status) => {
      setTunCapability(status);
    }).catch(err => {
      console.error('Failed to load TUN capability status:', err);
    });

    loadMonitorStatus();

    const handleMonitorEvent = (event: ConnectionMonitorEvent) => {
      setRecentEvents(prev => [event, ...prev].slice(0, 10));
      loadMonitorStatusRef.current?.();
    };

    const removeMonitorListener = window.electronAPI.onConnectionMonitorEvent(handleMonitorEvent);
    const interval = setInterval(loadMonitorStatus, 5000);

    return () => {
      removeMonitorListener();
      clearInterval(interval);
    };
  }, [isOpen, loadMonitorStatus]);

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
  }, []);

  const handleConnectionModeChange = useCallback(async (mode: ConnectionMode) => {
    if (monitorStatus?.isConnected) {
      setModeError('Disconnect before changing connection mode.');
      return;
    }
    if (mode === 'tun') {
      if (tunCapability && !tunCapability.supported) {
        setModeError(tunCapability.unsupportedReason || 'TUN mode is not supported on this operating system.');
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
  }, [monitorStatus?.isConnected, tunCapability]);

  const tunUnavailable = !!tunCapability && !tunCapability.supported;
  const tunNeedsPrivileges = !!tunCapability && tunCapability.supported && !tunCapability.hasPrivileges;
  const tunButtonDisabled = tunUnavailable;
  const modeLockedByConnection = !!monitorStatus?.isConnected;
  const xrayStateLabel = monitorStatus?.xrayState ? monitorStatus.xrayState.replace(/^\w/, (v) => v.toUpperCase()) : null;
  const healthStateLabel = monitorStatus?.lastHealthState ? monitorStatus.lastHealthState.replace(/^\w/, (v) => v.toUpperCase()) : null;
  const formatTimestamp = (value: number | null | undefined) => (value ? new Date(value).toLocaleTimeString() : 'n/a');

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
            <h2 className="text-lg sm:text-xl font-semibold text-white tracking-tight">Settings</h2>
            <p className="text-xs text-gray-400 mt-1 leading-relaxed max-w-md">Sources, routing, and connection health</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="self-end sm:self-center rounded-xl p-2.5 text-gray-400 hover:text-white hover:bg-white/5 border border-transparent hover:border-gray-700/50 transition-colors"
            aria-label="Close settings"
          >
            <X className="w-5 h-5" />
          </button>
        </header>

        <nav
          className="relative z-10 shrink-0 px-3 sm:px-6 py-2 flex gap-1.5 overflow-x-auto"
          role="tablist"
          aria-label="Settings sections"
        >
          {SETTINGS_TABS.map(({ id, label, icon: Icon }) => (
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
              {label}
            </button>
          ))}
        </nav>

        <div className="flex-1 min-h-0 overflow-y-auto relative z-10 px-4 sm:px-6 py-4 sm:py-5 pb-6 text-sm leading-relaxed">
          {activeTab === 'sources' && (
          <div className="space-y-6">
            <div>
            <p className="text-sm font-medium text-gray-300 mb-3">Subscriptions and imports</p>
            {/* Subscription list */}
            <div className="space-y-2 mb-4">
              {subscriptions.length === 0 && (
                <p className="text-sm text-gray-500 px-0.5 leading-relaxed">No subscriptions yet. Add one below.</p>
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
                  Add subscription
                </span>
                <ChevronDown className={`w-5 h-5 text-gray-400 transition-transform shrink-0 ${isAddFormExpanded ? 'rotate-180' : ''}`} />
              </button>
              {isAddFormExpanded && (
                <form onSubmit={handleAddSubscription} className="px-4 pb-4 space-y-3">
                  <input
                    type="text"
                    value={newSubName}
                    onChange={(e) => setNewSubName(e.target.value)}
                    placeholder="Name (e.g. Work VPN)"
                    maxLength={100}
                    className="w-full bg-black/40 border border-gray-600/50 rounded-xl px-3 py-2.5 text-sm text-white placeholder:text-gray-500 focus:border-primary/60 focus:ring-2 focus:ring-primary/20 outline-none transition-all"
                  />
                  <input
                    type="text"
                    value={newSubUrl}
                    onChange={(e) => setNewSubUrl(e.target.value)}
                    placeholder="https://example.com/sub"
                    className="w-full bg-black/40 border border-gray-600/50 rounded-xl px-3 py-2.5 text-sm text-white placeholder:text-gray-500 focus:border-primary/60 focus:ring-2 focus:ring-primary/20 outline-none transition-all"
                  />
                  {addError && <p className="text-xs text-orange-400 leading-relaxed">{addError}</p>}
                  <button
                    type="submit"
                    disabled={isAdding}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold bg-gradient-to-r from-primary to-blue-600 text-white hover:from-blue-500 hover:to-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                  >
                    {isAdding ? <Loader2 className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />}
                    {isAdding ? 'Adding...' : 'Add and fetch'}
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
              Open preview and import mobile list
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
                    Manual configs (multi-paste)
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
                        placeholder="Paste any text from clipboard. All vless:// and trojan:// links will be extracted."
                        className="w-full resize-y min-h-[120px] bg-black/40 backdrop-blur-sm border border-gray-600/50 rounded-xl px-3 py-3 text-sm text-white placeholder:text-gray-500 focus:border-primary/60 focus:ring-2 focus:ring-primary/20 outline-none transition-all duration-200 hover:border-gray-500/70 leading-relaxed"
                      />
                      <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-primary/0 via-primary/5 to-primary/0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />
                    </div>
                    <p className="text-xs text-gray-500 mt-2 leading-relaxed">Mixed clipboard text is fine; links are extracted automatically.</p>
                    <div className="flex justify-end mt-3">
                      <button
                        type="submit"
                        disabled={isSavingManual}
                        className="px-4 py-2 bg-gradient-to-r from-primary to-blue-600 rounded-lg text-white text-sm font-semibold hover:from-blue-500 hover:to-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-all"
                      >
                        {isSavingManual && <Loader2 className="w-5 h-5 animate-spin" />}
                        {isSavingManual ? 'Saving...' : 'Save manual'}
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
              <h3 className="text-sm font-semibold text-gray-200">Network mode</h3>
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
                <div className="text-sm font-semibold mb-1">Proxy mode</div>
                <div className="text-xs text-gray-400 leading-relaxed">System proxy for typical desktop apps.</div>
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
                <div className="text-sm font-semibold mb-1">TUN mode</div>
                <div className="text-xs text-gray-400 leading-relaxed">Full system traffic. May require elevated privileges.</div>
              </button>
            </div>

            <p className="text-sm text-gray-500 leading-relaxed">Disconnect before changing mode. The choice applies on the next connection.</p>
            {tunUnavailable && (
              <p className="text-sm text-orange-400 leading-relaxed">{tunCapability?.unsupportedReason || 'TUN mode is unavailable on this platform.'}</p>
            )}
            {tunNeedsPrivileges && (
              <p className="text-sm text-orange-400 leading-relaxed">
                {tunCapability?.privilegeHint || 'Elevated privileges are required for TUN mode.'} You can still select TUN now; elevation will be requested on connect.
              </p>
            )}
            {tunCapability?.routeMode && (
              <p className="text-sm text-gray-500 leading-relaxed">Routing mode: {tunCapability.routeMode}</p>
            )}
            {tunCapability?.degradedReason && (
              <p className="text-sm text-orange-400 leading-relaxed">{tunCapability.degradedReason}</p>
            )}
            {modeError && <p className="text-sm text-orange-400 leading-relaxed">{modeError}</p>}
          </div>
          )}

          {activeTab === 'diagnostics' && (
          <div className="space-y-6">
            <div className="flex items-center gap-2.5 mb-1">
              <RefreshCw className="w-4 h-4 text-primary shrink-0" />
              <h3 className="text-sm font-semibold text-gray-200">Connection monitoring</h3>
            </div>

            <div className="mb-2 p-4 rounded-xl bg-gradient-to-br from-gray-800/50 to-gray-800/30 border border-gray-700/50">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-white mb-1">Auto server switching</div>
                  <div className="text-xs text-gray-400 leading-relaxed">Switch to another server when the current one looks blocked.</div>
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
                      <span className="text-gray-400">Current server</span>
                      <span className="text-white font-medium text-right truncate">{monitorStatus.currentServer.name}</span>
                    </div>
                  )}
                  {monitorStatus.blockedServers.length > 0 && (
                    <div className="flex items-center justify-between text-sm gap-3">
                      <span className="text-gray-400">Blocked servers</span>
                      <span className="text-orange-400 font-medium">{monitorStatus.blockedServers.length}</span>
                    </div>
                  )}
                  {monitorStatus.lastError && (
                    <div className="flex items-start gap-2.5 text-sm">
                      <AlertTriangle className="w-4 h-4 text-orange-400 mt-0.5 flex-shrink-0" />
                      <span className="text-gray-400 flex-1 min-w-0 break-words" title={monitorStatus.lastError}>
                        Last error: {monitorStatus.lastError}
                      </span>
                    </div>
                  )}
                  {xrayStateLabel && (
                    <div className="flex items-center justify-between text-sm gap-3">
                      <span className="text-gray-400">Xray state</span>
                      <span className={monitorStatus.xrayRunning ? 'text-green-400 font-medium' : 'text-gray-300 font-medium'}>
                        {xrayStateLabel}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center justify-between text-sm gap-3">
                    <span className="text-gray-400">Last health check</span>
                    <span className="text-gray-300">{formatTimestamp(monitorStatus.lastHealthCheckAt)}</span>
                  </div>
                  {healthStateLabel && (
                    <div className="flex items-center justify-between text-sm gap-3">
                      <span className="text-gray-400">Health state</span>
                      <span className="text-gray-300">{healthStateLabel}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between text-sm gap-3">
                    <span className="text-gray-400">Local proxy reachable</span>
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
                            Health failure: {monitorStatus.lastHealthFailureReason}
                          </span>
                        </div>
                      )}
                      {monitorStatus.xrayLastFailureReason && (
                        <div className="flex items-start gap-2.5 text-sm">
                          <AlertTriangle className="w-4 h-4 text-orange-400 mt-0.5 flex-shrink-0" />
                          <span className="text-gray-400 flex-1 min-w-0 break-words" title={monitorStatus.xrayLastFailureReason}>
                            Xray failure: {monitorStatus.xrayLastFailureReason}
                          </span>
                        </div>
                      )}
                      {(monitorStatus.recoveryInProgress || monitorStatus.recoveryBlocked) && (
                        <div className="flex items-start gap-2.5 text-sm">
                          <RefreshCw className={`w-4 h-4 mt-0.5 flex-shrink-0 ${monitorStatus.recoveryInProgress ? 'text-blue-400 animate-spin' : 'text-orange-400'}`} />
                          <span className="text-gray-400 flex-1 leading-relaxed">
                            {monitorStatus.recoveryInProgress
                              ? `Recovery in progress (${monitorStatus.recoveryAttemptCount})`
                              : `Recovery paused after ${monitorStatus.recoveryAttemptCount} attempts`}
                            {monitorStatus.lastRecoveryTrigger ? ` via ${monitorStatus.lastRecoveryTrigger}` : ''}
                            {monitorStatus.lastRecoveryReason ? `: ${monitorStatus.lastRecoveryReason}` : ''}
                          </span>
                        </div>
                      )}
                      {monitorStatus.lastFatalReason && (
                        <div className="flex items-start gap-2.5 text-sm">
                          <X className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
                          <span className="text-gray-400 flex-1 min-w-0 break-words" title={monitorStatus.lastFatalReason}>
                            Last fatal reason: {monitorStatus.lastFatalReason}
                          </span>
                        </div>
                      )}
                      <div className="flex items-center justify-between text-sm gap-3">
                        <span className="text-gray-400">Last recovery</span>
                        <span className="text-gray-300">{formatTimestamp(monitorStatus.lastRecoveryAt)}</span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {monitorStatus && monitorStatus.blockedServers.length > 0 && (
                <div className="mt-4 pt-4 border-t border-gray-700/50">
                  <div className="flex items-center justify-between mb-3 gap-2">
                    <span className="text-sm text-gray-400">Blocked servers ({monitorStatus.blockedServers.length})</span>
                    <button
                      type="button"
                      onClick={handleClearBlocked}
                      className="text-sm text-primary hover:text-blue-400 transition-colors flex items-center gap-1.5 shrink-0"
                    >
                      <X className="w-4 h-4" />
                      Clear
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
              <h3 className="text-sm font-semibold text-gray-200">Troubleshooting</h3>
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
                  {copied ? 'Copied!' : 'Copy logs'}
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
                  Open folder
                </span>
              </button>
            </div>

            <div className="mt-4 p-3 rounded-lg bg-gray-800/30 border border-gray-700/30">
              <p className="text-xs text-gray-500 text-center leading-relaxed">
                <Shield className="w-3.5 h-3.5 inline-block mr-1.5 mb-0.5 align-text-bottom opacity-80" />
                Logs are sanitized to remove sensitive personal data
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
