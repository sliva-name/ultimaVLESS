import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Copy, FolderOpen, Check, Loader2, Settings, Link2, Shield, RefreshCw, AlertTriangle, X, ChevronDown } from 'lucide-react';
import { ConnectionStatus as MonitorStatus, ConnectionMonitorEvent } from '../preload.d';
import { ConnectionMode, VlessConfig } from '../../shared/types';
import { SaveSubscriptionPayload, TunCapabilityStatus } from '../../shared/ipc';

interface SettingsModalProps {
  isOpen: boolean;
  isLoading: boolean;
  servers: VlessConfig[];
  onClose: () => void;
  onSave: (payload: SaveSubscriptionPayload) => Promise<{ ok: boolean; error?: string }>;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, isLoading, servers, onClose, onSave }) => {
  const [subUrl, setSubUrl] = useState('');
  const [manualLinks, setManualLinks] = useState('');
  const [isSubscriptionExpanded, setIsSubscriptionExpanded] = useState(true);
  const [isManualExpanded, setIsManualExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [modeError, setModeError] = useState<string | null>(null);
  const [autoSwitching, setAutoSwitching] = useState(true);
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>('proxy');
  const [tunCapability, setTunCapability] = useState<TunCapabilityStatus | null>(null);
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
    setSaveError(null);
    setModeError(null);

    window.electronAPI.getSubscriptionUrl().then((url) => {
      setSubUrl(url || '');
    }).catch(err => {
      console.error('Failed to load subscription URL:', err);
    });

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

    const handleManualLinksUpdated = (updatedManualLinks: string) => {
      setManualLinks(updatedManualLinks || '');
    };

    const removeMonitorListener = window.electronAPI.onConnectionMonitorEvent(handleMonitorEvent);
    const removeManualLinksListener = window.electronAPI.onManualLinksUpdated(handleManualLinksUpdated);
    const interval = setInterval(loadMonitorStatus, 5000);

    return () => {
      removeMonitorListener();
      removeManualLinksListener();
      clearInterval(interval);
    };
  }, [isOpen, loadMonitorStatus]);

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


  const handleClearBlocked = useCallback(async () => {
    try {
      await window.electronAPI.clearBlockedServers();
      loadMonitorStatus();
    } catch (err) {
      console.error('Failed to clear blocked servers:', err);
    }
  }, [loadMonitorStatus]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveError(null);
    const isSaved = await onSave({
      subscriptionUrl: subUrl.trim(),
      manualLinks,
    });
    if (!isSaved.ok) {
      setSaveError(isSaved.error || 'Failed to save subscription. Check URL/links and try again.');
    }
  }, [onSave, subUrl, manualLinks]);

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
    <div className="flex-1 flex flex-col items-center justify-center p-8 animate-[fadeIn_0.3s_ease-out] overflow-hidden">
      <div className="w-full max-w-2xl max-h-[90vh] bg-gradient-to-br from-surface via-surface to-surface/95 backdrop-blur-xl rounded-2xl border border-gray-700/50 shadow-2xl shadow-black/50 relative overflow-hidden flex flex-col">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent pointer-events-none z-0" />
        
        <div className="flex-1 overflow-y-auto p-8 space-y-6 relative z-10 pb-8">
        
          <div>
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2.5 rounded-xl bg-primary/10 border border-primary/20">
                <Settings className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-white tracking-tight">Subscription Settings</h2>
                <p className="text-sm text-gray-400 mt-0.5">Configure your VLESS connection</p>
              </div>
            </div>
            
            <form onSubmit={handleSubmit} className="space-y-5">
            <div className="rounded-xl border border-gray-700/50 bg-gray-900/20 overflow-hidden">
              <button
                type="button"
                onClick={() => setIsSubscriptionExpanded((prev) => !prev)}
                className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-white/5 transition-colors"
              >
                <span className="flex items-center gap-2 text-sm font-medium text-gray-300">
                  <Link2 className="w-4 h-4 text-primary" />
                  Subscription URL
                </span>
                <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${isSubscriptionExpanded ? 'rotate-180' : ''}`} />
              </button>
              {isSubscriptionExpanded && (
                <div className="px-4 pb-4">
                  <div className="relative group">
                    <input
                      type="text"
                      value={subUrl}
                      onChange={(e) => setSubUrl(e.target.value)}
                      placeholder="https://ultm.app/..."
                      className="w-full bg-black/40 backdrop-blur-sm border border-gray-600/50 rounded-xl px-4 py-3.5 text-white placeholder:text-gray-500 focus:border-primary/60 focus:ring-2 focus:ring-primary/20 outline-none transition-all duration-200 hover:border-gray-500/70"
                    />
                    <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-primary/0 via-primary/5 to-primary/0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />
                  </div>
                  <p className="text-xs text-gray-500 mt-2">Used for automatic updates from provider.</p>
                </div>
              )}
            </div>

            <div className="rounded-xl border border-gray-700/50 bg-gray-900/20 overflow-hidden">
              <button
                type="button"
                onClick={() => setIsManualExpanded((prev) => !prev)}
                className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-white/5 transition-colors"
              >
                <span className="flex items-center gap-2 text-sm font-medium text-gray-300">
                  <Link2 className="w-4 h-4 text-primary" />
                  Manual configs (multi-paste)
                </span>
                <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${isManualExpanded ? 'rotate-180' : ''}`} />
              </button>
              {isManualExpanded && (
                <div className="px-4 pb-4">
                  <div className="relative group">
                    <textarea
                      value={manualLinks}
                      onChange={(e) => setManualLinks(e.target.value)}
                      rows={7}
                      placeholder="Paste any text from clipboard. All vless://, trojan://, hysteria2:// links will be extracted."
                      className="w-full resize-y min-h-[140px] bg-black/40 backdrop-blur-sm border border-gray-600/50 rounded-xl px-4 py-3.5 text-white placeholder:text-gray-500 focus:border-primary/60 focus:ring-2 focus:ring-primary/20 outline-none transition-all duration-200 hover:border-gray-500/70"
                    />
                    <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-primary/0 via-primary/5 to-primary/0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />
                  </div>
                  <p className="text-xs text-gray-500 mt-2">Can include mixed clipboard text, not only one-link-per-line.</p>
                </div>
              )}
            </div>
            
            <div className="flex justify-end gap-3 pt-2">
              <button 
                type="button" 
                onClick={onClose} 
                disabled={isLoading}
                className="px-5 py-2.5 rounded-xl text-gray-300 font-medium hover:bg-white/5 hover:text-white transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed border border-transparent hover:border-gray-700/50"
              >
                Cancel
              </button>
              <button 
                type="submit" 
                disabled={isLoading}
                className="px-6 py-2.5 bg-gradient-to-r from-primary to-blue-600 rounded-xl text-white font-semibold hover:from-blue-500 hover:to-blue-700 disabled:from-primary/50 disabled:to-blue-600/50 flex items-center gap-2 transition-all duration-200 shadow-lg shadow-primary/25 hover:shadow-primary/40 disabled:shadow-none disabled:cursor-not-allowed transform hover:scale-[1.02] active:scale-[0.98]"
              >
                {isLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                {isLoading ? 'Updating...' : 'Save & Update'}
              </button>
            </div>
            {saveError && (
              <p className="text-xs text-orange-400 pt-1">{saveError}</p>
            )}
            </form>
          </div>

          <div className="pt-4 border-t border-gray-800/50">
            <div className="flex items-center gap-2 mb-4">
              <Shield className="w-4 h-4 text-primary" />
              <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Network Mode</h3>
            </div>

            <div className="grid grid-cols-2 gap-3">
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
                <div className="text-sm font-semibold mb-1">Proxy Mode</div>
                <div className="text-xs text-gray-400">System proxy mode for regular desktop apps.</div>
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
                <div className="text-sm font-semibold mb-1">TUN Mode</div>
                <div className="text-xs text-gray-400">Routes full system traffic. Requires elevated privileges.</div>
              </button>
            </div>

            <p className="text-xs text-gray-500 mt-3">Disconnect before changing mode. The selected mode applies on the next connection.</p>
            {tunUnavailable && (
              <p className="text-xs text-orange-400 mt-2">{tunCapability?.unsupportedReason || 'TUN mode is unavailable on this platform.'}</p>
            )}
            {tunNeedsPrivileges && (
              <p className="text-xs text-orange-400 mt-2">
                {tunCapability?.privilegeHint || 'Elevated privileges are required for TUN mode.'} You can still select TUN now; elevation will be requested on connect.
              </p>
            )}
            {modeError && <p className="text-xs text-orange-400 mt-2">{modeError}</p>}
          </div>

          <div className="pt-4 border-t border-gray-800/50">
            <div className="flex items-center gap-2 mb-4">
              <RefreshCw className="w-4 h-4 text-primary" />
              <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Connection Monitoring</h3>
            </div>

            <div className="mb-4 p-4 rounded-xl bg-gradient-to-br from-gray-800/50 to-gray-800/30 border border-gray-700/50">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="text-sm font-medium text-white mb-1">Auto Server Switching</div>
                <div className="text-xs text-gray-400">Automatically switch to another server when connection is blocked</div>
              </div>
              <button
                onClick={() => handleToggleAutoSwitching(!autoSwitching)}
                className={`
                  relative w-12 h-6 rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-primary/50
                  ${autoSwitching ? 'bg-primary' : 'bg-gray-700'}
                `}
              >
                <div
                  className={`
                    absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform duration-200
                    ${autoSwitching ? 'translate-x-6' : 'translate-x-0'}
                  `}
                />
              </button>
            </div>

            {monitorStatus && (
              <div className="mt-3 pt-3 border-t border-gray-700/50 space-y-2">
                {monitorStatus.isConnected && monitorStatus.currentServer && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-gray-400">Current Server:</span>
                    <span className="text-white font-medium">{monitorStatus.currentServer.name}</span>
                  </div>
                )}
                {monitorStatus.blockedServers.length > 0 && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-gray-400">Blocked Servers:</span>
                    <span className="text-orange-400 font-medium">{monitorStatus.blockedServers.length}</span>
                  </div>
                )}
                {monitorStatus.lastError && (
                  <div className="flex items-start gap-2 text-xs">
                    <AlertTriangle className="w-3 h-3 text-orange-400 mt-0.5 flex-shrink-0" />
                    <span className="text-gray-400 flex-1 truncate" title={monitorStatus.lastError}>
                      Last Error: {monitorStatus.lastError}
                    </span>
                  </div>
                )}
              </div>
            )}

            {monitorStatus && monitorStatus.blockedServers.length > 0 && (
              <div className="mt-3 pt-3 border-t border-gray-700/50">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-gray-400">Blocked Servers ({monitorStatus.blockedServers.length})</span>
                  <button
                    onClick={handleClearBlocked}
                    className="text-xs text-primary hover:text-blue-400 transition-colors flex items-center gap-1"
                  >
                    <X className="w-3 h-3" />
                    Clear
                  </button>
                </div>
                <div className="space-y-1 max-h-24 overflow-y-auto">
                  {monitorStatus.blockedServers.map((serverId) => {
                    const server = servers.find(s => s.uuid === serverId);
                    const serverName = server?.name
                      ?? (monitorStatus.currentServer?.uuid === serverId
                        ? monitorStatus.currentServer.name
                        : `Server ${serverId.substring(0, 8)}...`);
                    return (
                      <div key={serverId} className="text-xs text-orange-400 bg-orange-500/10 px-2 py-1 rounded border border-orange-500/20 truncate">
                        {serverName}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

            {recentEvents.length > 0 && (
              <div className="mb-4 p-4 rounded-xl bg-gradient-to-br from-gray-800/50 to-gray-800/30 border border-gray-700/50">
                <div className="text-xs text-gray-400 mb-3">Recent Events</div>
                <div className="space-y-2 max-h-32 overflow-y-auto">
                  {recentEvents.map((event, idx) => (
                    <div key={idx} className="text-xs p-2 rounded bg-gray-900/50 border border-gray-700/30">
                      <div className="flex items-center gap-2">
                        {event.type === 'error' && <AlertTriangle className="w-3 h-3 text-orange-400" />}
                        {event.type === 'blocked' && <X className="w-3 h-3 text-red-400" />}
                        {event.type === 'switching' && <RefreshCw className="w-3 h-3 text-blue-400" />}
                        {event.type === 'connected' && <Check className="w-3 h-3 text-green-400" />}
                        <span className="text-gray-300 flex-1 truncate">{event.message || event.type}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="pt-4 border-t border-gray-800/50">
            <div className="flex items-center gap-2 mb-4">
              <Shield className="w-4 h-4 text-gray-400" />
              <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Troubleshooting</h3>
            </div>
          
          <div className="grid grid-cols-2 gap-3">
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
                {copied ? 'Copied!' : 'Copy Logs'}
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
                Open Folder
              </span>
            </button>
          </div>
          
          <div className="mt-4 p-3 rounded-lg bg-gray-800/30 border border-gray-700/30">
            <p className="text-xs text-gray-500 text-center leading-relaxed">
              <Shield className="w-3 h-3 inline-block mr-1.5 mb-0.5" />
              Logs are sanitized to remove sensitive personal data
            </p>
            {copyError && (
              <p className="text-xs text-orange-400 text-center mt-2">{copyError}</p>
            )}
          </div>
          </div>
        </div>
      </div>
    </div>
  );
};
