import React, { useCallback, useState } from 'react';
import {
  RefreshCw,
  AlertTriangle,
  X,
  Shield,
  Copy,
  FolderOpen,
  Check,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { VlessConfig } from '@/shared/types';
import { ConnectionMonitorEvent, type AppSnapshot } from '@/shared/ipc';
import { Toggle } from '@/renderer/components/ui';

interface SettingsDiagnosticsTabProps {
  servers: VlessConfig[];
  snapshot: AppSnapshot;
  recentEvents: ConnectionMonitorEvent[];
}

const formatTimestamp = (value: number | null | undefined) =>
  value ? new Date(value).toLocaleTimeString() : 'n/a';

const capitalize = (value: string): string =>
  value.replace(/^\w/, (v) => v.toUpperCase());

export const SettingsDiagnosticsTab: React.FC<SettingsDiagnosticsTabProps> = ({
  servers,
  snapshot,
  recentEvents,
}) => {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const { session, health, process, recovery, autoSwitchingEnabled } = snapshot;
  const activeServer = servers.find(
    (server) => server.uuid === session.activeServerId,
  );

  const xrayStateLabel = process.state ? capitalize(process.state) : null;
  const healthStateLabel = health.lastHealthState
    ? capitalize(health.lastHealthState)
    : null;

  const handleToggleAutoSwitching = useCallback(async (enabled: boolean) => {
    try {
      await window.electronAPI.setAutoSwitching(enabled);
    } catch (err) {
      console.error('Failed to toggle auto-switching:', err);
    }
  }, []);

  const handleClearBlocked = useCallback(async () => {
    try {
      await window.electronAPI.clearBlockedServers();
    } catch (err) {
      console.error('Failed to clear blocked servers:', err);
    }
  }, []);

  const handleCopyLogs = useCallback(async () => {
    setCopyError(null);
    try {
      const logs = await window.electronAPI.getLogs();
      await navigator.clipboard.writeText(logs);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy logs', error);
      setCopyError(t('settings.diagnostics.copyLogsFailed'));
      setCopied(false);
    }
  }, [t]);

  const handleOpenFolder = useCallback(() => {
    void window.electronAPI.openLogFolder().catch((error) => {
      console.error('Failed to open log folder', error);
    });
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2.5 mb-1">
        <RefreshCw className="w-4 h-4 text-primary shrink-0" />
        <h3 className="text-sm font-semibold text-gray-200">
          {t('settings.diagnostics.monitoring')}
        </h3>
      </div>

      <div className="mb-2 p-4 rounded-xl bg-linear-to-br from-gray-800/50 to-gray-800/30 border border-gray-700/50">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-white mb-1">
              {t('settings.diagnostics.autoSwitching')}
            </div>
            <div className="text-xs text-gray-400 leading-relaxed">
              {t('settings.diagnostics.autoSwitchingDesc')}
            </div>
          </div>
          <Toggle
            size="md"
            checked={autoSwitchingEnabled}
            onChange={handleToggleAutoSwitching}
            ariaLabel={t('settings.diagnostics.autoSwitching')}
          />
        </div>

        <div className="mt-4 pt-4 border-t border-gray-700/50 space-y-3">
            {session.phase === 'connected' && activeServer && (
              <DiagRow label={t('settings.diagnostics.currentServer')}>
                <span className="text-white font-medium text-right truncate">
                  {activeServer.name}
                </span>
              </DiagRow>
            )}
            {session.blockedServerIds.length > 0 && (
              <DiagRow label={t('settings.diagnostics.blockedServers')}>
                <span className="text-orange-400 font-medium">
                  {session.blockedServerIds.length}
                </span>
              </DiagRow>
            )}
            {session.lastError && (
              <DiagError
                label={`${t('settings.diagnostics.lastError')}: ${session.lastError}`}
              />
            )}
            {xrayStateLabel && (
              <DiagRow label={t('settings.diagnostics.xrayState')}>
                <span
                  className={
                    process.xrayRunning
                      ? 'text-green-400 font-medium'
                      : 'text-gray-300 font-medium'
                  }
                >
                  {xrayStateLabel}
                </span>
              </DiagRow>
            )}
            <DiagRow label={t('settings.diagnostics.lastHealthCheck')}>
              <span className="text-gray-300">
                {formatTimestamp(health.lastHealthCheckAt)}
              </span>
            </DiagRow>
            {healthStateLabel && (
              <DiagRow label={t('settings.diagnostics.healthState')}>
                <span className="text-gray-300">{healthStateLabel}</span>
              </DiagRow>
            )}
            <DiagRow label={t('settings.diagnostics.localProxy')}>
              <span className="text-gray-300">
                {health.localProxyReachable == null
                  ? 'n/a'
                  : health.localProxyReachable
                    ? 'yes'
                    : 'no'}
              </span>
            </DiagRow>
            {(health.lastHealthFailureReason ||
              process.lastFailureReason ||
              recovery.recoveryInProgress ||
              recovery.recoveryBlocked ||
              recovery.lastFatalReason) && (
              <div className="space-y-2 pt-2">
                {health.lastHealthFailureReason && (
                  <DiagError
                    label={`${t('settings.diagnostics.healthFailure')}: ${health.lastHealthFailureReason}`}
                  />
                )}
                {process.lastFailureReason && (
                  <DiagError
                    label={`${t('settings.diagnostics.xrayFailure')}: ${process.lastFailureReason}`}
                  />
                )}
                {(recovery.recoveryInProgress || recovery.recoveryBlocked) && (
                  <div className="flex items-start gap-2.5 text-sm">
                    <RefreshCw
                      className={`w-4 h-4 mt-0.5 shrink-0 ${recovery.recoveryInProgress ? 'text-blue-400 animate-spin' : 'text-orange-400'}`}
                    />
                    <span className="text-gray-400 flex-1 leading-relaxed">
                      {recovery.recoveryInProgress
                        ? t('settings.diagnostics.recoveryInProgress', {
                            count: recovery.recoveryAttemptCount,
                          })
                        : t('settings.diagnostics.recoveryPaused', {
                            count: recovery.recoveryAttemptCount,
                          })}
                      {recovery.lastRecoveryTrigger
                        ? ` via ${recovery.lastRecoveryTrigger}`
                        : ''}
                      {recovery.lastRecoveryReason
                        ? `: ${recovery.lastRecoveryReason}`
                        : ''}
                    </span>
                  </div>
                )}
                {recovery.lastFatalReason && (
                  <div className="flex items-start gap-2.5 text-sm">
                    <X className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                    <span
                      className="text-gray-400 flex-1 min-w-0 break-words"
                      title={recovery.lastFatalReason}
                    >
                      {t('settings.diagnostics.lastFatal')}:{' '}
                      {recovery.lastFatalReason}
                    </span>
                  </div>
                )}
                <DiagRow label={t('settings.diagnostics.lastRecovery')}>
                  <span className="text-gray-300">
                    {formatTimestamp(recovery.lastRecoveryAt)}
                  </span>
                </DiagRow>
              </div>
            )}
        </div>

        {session.blockedServerIds.length > 0 && (
          <div className="mt-4 pt-4 border-t border-gray-700/50">
            <div className="flex items-center justify-between mb-3 gap-2">
              <span className="text-sm text-gray-400">
                {t('settings.diagnostics.blockedServers')} (
                {session.blockedServerIds.length})
              </span>
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
              {session.blockedServerIds.map((serverId) => {
                const server = servers.find((s) => s.uuid === serverId);
                const serverName =
                  server?.name ??
                  (activeServer?.uuid === serverId
                    ? activeServer.name
                    : t('settings.diagnostics.serverShort', {
                        id: serverId.substring(0, 8),
                      }));
                return (
                  <div
                    key={serverId}
                    className="text-sm text-orange-400 bg-orange-500/10 px-3 py-1.5 rounded-lg border border-orange-500/20 truncate"
                  >
                    {serverName}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {recentEvents.length > 0 && (
        <div className="mb-2 p-4 rounded-xl bg-linear-to-br from-gray-800/50 to-gray-800/30 border border-gray-700/50">
          <div className="text-xs font-medium text-gray-300 mb-2">
            {t('settings.diagnostics.recentEvents')}
          </div>
          <div className="space-y-2 max-h-32 overflow-y-auto">
            {recentEvents.map((event, idx) => (
              <div
                key={idx}
                className="text-sm p-3 rounded-xl bg-gray-900/50 border border-gray-700/30"
              >
                <div className="flex items-start gap-2.5">
                  {event.type === 'error' && (
                    <AlertTriangle className="w-4 h-4 text-orange-400 shrink-0 mt-0.5" />
                  )}
                  {event.type === 'blocked' && (
                    <X className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  )}
                  {event.type === 'switching' && (
                    <RefreshCw className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
                  )}
                  {event.type === 'connected' && (
                    <Check className="w-4 h-4 text-green-400 shrink-0 mt-0.5" />
                  )}
                  <span className="text-gray-300 flex-1 min-w-0 leading-relaxed">
                    {event.message ||
                      t(`settings.diagnostics.eventTypes.${event.type}`, {
                        defaultValue: event.type,
                      })}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="flex items-center gap-2.5 mb-3">
          <Shield className="w-4 h-4 text-gray-400 shrink-0" />
          <h3 className="text-sm font-semibold text-gray-200">
            {t('settings.diagnostics.troubleshooting')}
          </h3>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            type="button"
            onClick={handleCopyLogs}
            className="group flex flex-col items-center justify-center gap-2.5 p-4 rounded-xl bg-linear-to-br from-gray-800/50 to-gray-800/30 hover:from-gray-700/60 hover:to-gray-700/40 transition-all duration-200 border border-gray-700/50 hover:border-gray-600/70 hover:shadow-lg hover:shadow-black/20 transform hover:scale-[1.02] active:scale-[0.98]"
          >
            <div
              className={`p-2 rounded-lg ${copied ? 'bg-green-500/20' : 'bg-gray-700/50 group-hover:bg-gray-600/50'} transition-all duration-200`}
            >
              {copied ? (
                <Check className="w-5 h-5 text-green-400" />
              ) : (
                <Copy className="w-5 h-5 text-gray-300 group-hover:text-white transition-colors" />
              )}
            </div>
            <span
              className={`text-sm font-medium ${copied ? 'text-green-400' : 'text-gray-300 group-hover:text-white'} transition-colors`}
            >
              {copied
                ? t('settings.diagnostics.copied')
                : t('settings.diagnostics.copyLogs')}
            </span>
          </button>

          <button
            type="button"
            onClick={handleOpenFolder}
            className="group flex flex-col items-center justify-center gap-2.5 p-4 rounded-xl bg-linear-to-br from-gray-800/50 to-gray-800/30 hover:from-gray-700/60 hover:to-gray-700/40 transition-all duration-200 border border-gray-700/50 hover:border-gray-600/70 hover:shadow-lg hover:shadow-black/20 transform hover:scale-[1.02] active:scale-[0.98]"
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
            <p className="text-sm text-orange-400 text-center mt-3 leading-relaxed">
              {copyError}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Local row primitives
// ---------------------------------------------------------------------------

const DiagRow: React.FC<{ label: string; children: React.ReactNode }> = ({
  label,
  children,
}) => (
  <div className="flex items-center justify-between text-sm gap-3">
    <span className="text-gray-400">{label}</span>
    {children}
  </div>
);

const DiagError: React.FC<{ label: string }> = ({ label }) => (
  <div className="flex items-start gap-2.5 text-sm">
    <AlertTriangle className="w-4 h-4 text-orange-400 mt-0.5 shrink-0" />
    <span className="text-gray-400 flex-1 min-w-0 break-words" title={label}>
      {label}
    </span>
  </div>
);
