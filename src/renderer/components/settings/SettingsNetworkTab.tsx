import React, { useCallback, useEffect, useState } from 'react';
import clsx from 'clsx';
import { Shield, Activity, AlertTriangle, Loader2, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  ConnectionMode,
  DEFAULT_PERFORMANCE_SETTINGS,
  DomainStrategy,
  LogLevel,
  PerformanceSettings,
  TlsFingerprint,
  XudpProxyUDP443,
} from '@/shared/types';
import { TunCapabilityStatus } from '@/shared/ipc';
import { PrimaryButton, Toggle } from '@/renderer/components/ui';

interface SettingsNetworkTabProps {
  isOpen: boolean;
  isConnected: boolean;
  isConnectionBusy: boolean;
  hasLoadedMonitorStatus: boolean;
  monitorIsConnected: boolean;
}

export const SettingsNetworkTab: React.FC<SettingsNetworkTabProps> = ({
  isOpen,
  isConnected,
  isConnectionBusy,
  hasLoadedMonitorStatus,
  monitorIsConnected,
}) => {
  const { t } = useTranslation();

  const [connectionMode, setConnectionMode] = useState<ConnectionMode>('proxy');
  const [tunCapability, setTunCapability] = useState<TunCapabilityStatus | null>(null);
  const [modeError, setModeError] = useState<string | null>(null);

  const [perfSettings, setPerfSettings] = useState<PerformanceSettings>(DEFAULT_PERFORMANCE_SETTINGS);
  const [perfDirty, setPerfDirty] = useState(false);
  const [perfSaving, setPerfSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setModeError(null);

    window.electronAPI.getConnectionMode()
      .then(setConnectionMode)
      .catch((err) => console.error('Failed to load connection mode:', err));

    window.electronAPI.getPerformanceSettings()
      .then((settings) => {
        setPerfSettings(settings);
        setPerfDirty(false);
      })
      .catch((err) => console.error('Failed to load performance settings:', err));

    window.electronAPI.getTunCapabilityStatus()
      .then(setTunCapability)
      .catch((err) => console.error('Failed to load TUN capability status:', err));
  }, [isOpen]);

  const handleConnectionModeChange = useCallback(async (mode: ConnectionMode) => {
    if (!hasLoadedMonitorStatus) return;
    if (monitorIsConnected) {
      setModeError(t('settings.network.disconnectHintError'));
      return;
    }
    if (mode === 'tun' && tunCapability && !tunCapability.supported) {
      setModeError(
        tunCapability.platform === 'darwin'
          ? t('settings.network.tunUnsupportedDarwin')
          : t('settings.network.tunUnavailable')
      );
      return;
    }
    try {
      await window.electronAPI.setConnectionMode(mode);
      setConnectionMode(mode);
      setModeError(null);
    } catch (err) {
      console.error('Failed to set connection mode:', err);
      setModeError(err instanceof Error ? err.message : 'Failed to set connection mode');
    }
  }, [hasLoadedMonitorStatus, monitorIsConnected, tunCapability, t]);

  const updatePerfField = useCallback(<K extends keyof PerformanceSettings>(
    key: K,
    value: PerformanceSettings[K]
  ) => {
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
      setPerfDirty(true);
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

  const tunUnavailable = !!tunCapability && !tunCapability.supported;
  const tunNeedsPrivileges = !!tunCapability && tunCapability.supported && !tunCapability.hasPrivileges;
  const tunButtonDisabled = tunUnavailable;
  const modeControlsDisabled = !hasLoadedMonitorStatus;
  // Prefer the authoritative renderer-side connection state (ws-fast updates)
  // and only fall back to the polled monitor status so the lock reacts the
  // moment a user (dis)connects, even before the next monitor poll.
  const networkLocked = isConnected || isConnectionBusy || monitorIsConnected;
  const modeLockedByConnection = networkLocked;

  const modeButtonClass = (active: boolean, disabled: boolean) => clsx(
    'p-4 rounded-xl border text-left transition-all duration-200',
    active
      ? 'border-primary/70 bg-primary/10 text-white'
      : disabled
        ? 'border-gray-800/80 bg-gray-900/30 text-gray-500 cursor-not-allowed opacity-70'
        : 'border-gray-700/50 bg-gray-800/40 text-gray-300 hover:border-gray-600/70'
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2.5 mb-1">
        <Shield className="w-4 h-4 text-primary shrink-0" />
        <h3 className="text-sm font-semibold text-gray-200">{t('settings.network.mode')}</h3>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => handleConnectionModeChange('proxy')}
          disabled={modeControlsDisabled || modeLockedByConnection}
          className={modeButtonClass(connectionMode === 'proxy', modeControlsDisabled || modeLockedByConnection)}
        >
          <div className="text-sm font-semibold mb-1">{t('settings.network.proxyMode')}</div>
          <div className="text-xs text-gray-400 leading-relaxed">{t('settings.network.proxyDesc')}</div>
        </button>
        <button
          type="button"
          onClick={() => handleConnectionModeChange('tun')}
          disabled={modeControlsDisabled || tunButtonDisabled || modeLockedByConnection}
          className={modeButtonClass(
            connectionMode === 'tun',
            modeControlsDisabled || tunButtonDisabled || modeLockedByConnection
          )}
        >
          <div className="text-sm font-semibold mb-1">{t('settings.network.tunMode')}</div>
          <div className="text-xs text-gray-400 leading-relaxed">{t('settings.network.tunDesc')}</div>
        </button>
      </div>

      <p className="text-sm text-gray-500 leading-relaxed">{t('settings.network.disconnectHint')}</p>
      {tunUnavailable && (
        <p className="text-sm text-orange-400 leading-relaxed">
          {tunCapability?.platform === 'darwin'
            ? t('settings.network.tunUnsupportedDarwin')
            : t('settings.network.tunUnavailable')}
        </p>
      )}
      {tunNeedsPrivileges && (
        <p className="text-sm text-orange-400 leading-relaxed">
          {tunCapability?.platform === 'win32'
            ? t('settings.network.tunElevated_win32')
            : t('settings.network.tunElevated')}
        </p>
      )}
      {tunCapability?.routeMode && (
        <p className="text-sm text-gray-500 leading-relaxed">
          {t('settings.network.routingMode', { mode: tunCapability.routeMode })}
        </p>
      )}
      {tunCapability?.degradedReason && (
        <p className="text-sm text-orange-400 leading-relaxed">
          {tunCapability.platform === 'linux'
            ? t('settings.network.tunDegradedLinux')
            : tunCapability.degradedReason}
        </p>
      )}
      {modeError && <p className="text-sm text-orange-400 leading-relaxed">{modeError}</p>}

      <div className="mt-6 pt-6 border-t border-gray-700/50 space-y-4">
        <div className="flex items-center gap-2.5 mb-1">
          <Activity className="w-4 h-4 text-primary shrink-0" />
          <h3 className="text-sm font-semibold text-gray-200">{t('settings.network.performance')}</h3>
        </div>
        <p className="text-xs text-gray-500 leading-relaxed">{t('settings.network.performanceHint')}</p>

        {networkLocked && (
          <div
            role="status"
            className="flex items-start gap-2.5 rounded-lg border border-orange-500/30 bg-orange-500/10 px-3 py-2 text-xs text-orange-200 leading-relaxed"
          >
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{t('settings.network.performanceLocked')}</span>
          </div>
        )}

        <fieldset
          disabled={networkLocked}
          aria-disabled={networkLocked}
          className={clsx(
            'space-y-3 transition-opacity duration-200',
            networkLocked && 'opacity-60 pointer-events-none select-none'
          )}
        >
          <PerfToggleRow
            label={t('settings.network.muxEnabled')}
            hint={t('settings.network.muxEnabledHint')}
            checked={perfSettings.muxEnabled}
            onChange={(v) => updatePerfField('muxEnabled', v)}
          />

          {perfSettings.muxEnabled && (
            <PerfNumberRow
              label={t('settings.network.muxConcurrency')}
              hint={t('settings.network.muxConcurrencyHint')}
              value={perfSettings.muxConcurrency}
              min={1}
              max={128}
              onChange={(v) => updatePerfField('muxConcurrency', v)}
            />
          )}

          <PerfNumberRow
            label={t('settings.network.xudpConcurrency')}
            hint={t('settings.network.xudpConcurrencyHint')}
            value={perfSettings.xudpConcurrency}
            min={1}
            max={1024}
            onChange={(v) => updatePerfField('xudpConcurrency', v)}
          />

          <PerfSelectRow
            label={t('settings.network.xudpProxyUDP443')}
            hint={t('settings.network.xudpProxyUDP443Hint')}
            value={perfSettings.xudpProxyUDP443}
            onChange={(v) => updatePerfField('xudpProxyUDP443', v as XudpProxyUDP443)}
            options={[
              { value: 'reject', label: t('settings.network.udp443Reject') },
              { value: 'allow', label: t('settings.network.udp443Allow') },
              { value: 'skip', label: t('settings.network.udp443Skip') },
            ]}
          />

          <PerfToggleRow
            label={t('settings.network.tcpFastOpen')}
            hint={t('settings.network.tcpFastOpenHint')}
            checked={perfSettings.tcpFastOpen}
            onChange={(v) => updatePerfField('tcpFastOpen', v)}
          />

          <PerfToggleRow
            label={t('settings.network.sniffingRouteOnly')}
            hint={t('settings.network.sniffingRouteOnlyHint')}
            checked={perfSettings.sniffingRouteOnly}
            onChange={(v) => updatePerfField('sniffingRouteOnly', v)}
          />

          <div className="border-t border-gray-700/40 my-1" />

          <PerfSelectRow
            label={t('settings.network.logLevel')}
            hint={t('settings.network.logLevelHint')}
            value={perfSettings.logLevel}
            onChange={(v) => updatePerfField('logLevel', v as LogLevel)}
            options={[
              { value: 'debug', label: 'debug' },
              { value: 'info', label: 'info' },
              { value: 'warning', label: 'warning' },
              { value: 'error', label: 'error' },
              { value: 'none', label: 'none' },
            ]}
          />

          <PerfSelectRow
            label={t('settings.network.fingerprint')}
            hint={t('settings.network.fingerprintHint')}
            value={perfSettings.fingerprint}
            onChange={(v) => updatePerfField('fingerprint', v as TlsFingerprint)}
            options={[
              { value: 'chrome', label: 'Chrome' },
              { value: 'firefox', label: 'Firefox' },
              { value: 'safari', label: 'Safari' },
              { value: 'edge', label: 'Edge' },
              { value: 'random', label: 'Random' },
              { value: 'randomized', label: 'Randomized' },
            ]}
          />

          <PerfToggleRow
            label={t('settings.network.blockAds')}
            hint={t('settings.network.blockAdsHint')}
            checked={perfSettings.blockAds}
            onChange={(v) => updatePerfField('blockAds', v)}
          />

          <PerfToggleRow
            label={t('settings.network.blockBittorrent')}
            hint={t('settings.network.blockBittorrentHint')}
            checked={perfSettings.blockBittorrent}
            onChange={(v) => updatePerfField('blockBittorrent', v)}
          />

          <PerfSelectRow
            label={t('settings.network.domainStrategy')}
            hint={t('settings.network.domainStrategyHint')}
            value={perfSettings.domainStrategy}
            onChange={(v) => updatePerfField('domainStrategy', v as DomainStrategy)}
            options={[
              { value: 'AsIs', label: 'AsIs' },
              { value: 'IPIfNonMatch', label: 'IPIfNonMatch' },
              { value: 'IPOnDemand', label: 'IPOnDemand' },
            ]}
          />
        </fieldset>

        <div className="flex items-center gap-3 pt-2">
          <PrimaryButton
            type="button"
            onClick={handleSavePerfSettings}
            disabled={!perfDirty || perfSaving || networkLocked}
            className="flex-1 disabled:opacity-40"
          >
            {perfSaving && <Loader2 className="w-4 h-4 animate-spin" />}
            {perfDirty
              ? (perfSaving ? t('settings.sources.saving') : t('settings.sources.saveManual'))
              : <Check className="w-4 h-4" />}
          </PrimaryButton>
          <button
            type="button"
            onClick={handleResetPerfDefaults}
            disabled={perfSaving || networkLocked}
            className="px-4 py-2 rounded-lg text-sm font-medium text-gray-400 border border-gray-700/50 hover:text-gray-200 hover:border-gray-600/70 hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {t('settings.network.resetDefaults')}
          </button>
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Local row primitives — colocated because they are only relevant here.
// ---------------------------------------------------------------------------

interface PerfRowProps {
  label: string;
  hint: string;
}

const PerfLabel: React.FC<PerfRowProps> = ({ label, hint }) => (
  <div className="min-w-0">
    <div className="text-sm text-gray-200">{label}</div>
    <div className="text-xs text-gray-500 leading-relaxed mt-0.5">{hint}</div>
  </div>
);

const PerfToggleRow: React.FC<PerfRowProps & { checked: boolean; onChange: (v: boolean) => void }> = ({
  label, hint, checked, onChange,
}) => (
  <div className="flex items-center justify-between gap-3">
    <PerfLabel label={label} hint={hint} />
    <Toggle checked={checked} onChange={onChange} ariaLabel={label} />
  </div>
);

const PerfNumberRow: React.FC<PerfRowProps & {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}> = ({ label, hint, value, min, max, onChange }) => (
  <div className="flex items-center justify-between gap-3">
    <PerfLabel label={label} hint={hint} />
    <input
      type="number"
      min={min}
      max={max}
      value={value}
      aria-label={label}
      onChange={(e) => onChange(Math.max(min, Math.min(max, parseInt(e.target.value) || min)))}
      className="w-20 bg-black/40 border border-gray-600/50 rounded-lg px-2 py-1.5 text-sm text-white text-center focus:border-primary/60 focus:ring-1 focus:ring-primary/20 outline-none"
    />
  </div>
);

const PerfSelectRow: React.FC<PerfRowProps & {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}> = ({ label, hint, value, onChange, options }) => (
  <div className="flex items-center justify-between gap-3">
    <PerfLabel label={label} hint={hint} />
    <select
      value={value}
      aria-label={label}
      onChange={(e) => onChange(e.target.value)}
      className="bg-black/40 border border-gray-600/50 rounded-lg px-2 py-1.5 text-sm text-white focus:border-primary/60 focus:ring-1 focus:ring-primary/20 outline-none"
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>{opt.label}</option>
      ))}
    </select>
  </div>
);
