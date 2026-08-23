import React, { useCallback, useState } from 'react';
import clsx from 'clsx';
import { Shield, Activity, AlertTriangle, Loader2, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  ConnectionMode,
  DomainStrategy,
  LogLevel,
  RemoteDnsPreset,
  REMOTE_DNS_PRESET_SERVERS,
  TlsFingerprint,
  TUN_MTU_MAX,
  TUN_MTU_MIN,
  TunDnsQueryStrategy,
  WindowsTunRouting,
  XudpProxyUDP443,
} from '@/shared/types';
import { PrimaryButton, Select, Toggle } from '@/renderer/components/ui';
import type { SelectOption } from '@/renderer/components/ui';
import { useNetworkSettings } from '@/renderer/hooks/useNetworkSettings';
import { SplitTunnelEditor } from './SplitTunnelEditor';

interface SettingsNetworkTabProps {
  isOpen: boolean;
  isConnected: boolean;
  isConnectionBusy: boolean;
}

export const SettingsNetworkTab: React.FC<SettingsNetworkTabProps> = ({
  isOpen,
  isConnected,
  isConnectionBusy,
}) => {
  const { t } = useTranslation();
  const {
    connectionMode,
    setConnectionMode,
    tunCapability,
    modeError,
    setModeError,
    perfSettings,
    perfDirty,
    perfSaving,
    updatePerfField,
    savePerfSettings,
    resetPerfDefaults,
  } = useNetworkSettings(isOpen);

  const handleConnectionModeChange = useCallback(
    async (mode: ConnectionMode) => {
      if (isConnected || isConnectionBusy) {
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
          err instanceof Error ? err.message : 'Failed to set connection mode',
        );
      }
    },
    [
      isConnected,
      isConnectionBusy,
      setConnectionMode,
      setModeError,
      tunCapability,
      t,
    ],
  );

  const [perfError, setPerfError] = useState<string | null>(null);

  const handleSavePerfSettings = useCallback(async () => {
    setPerfError(null);
    try {
      await savePerfSettings();
    } catch (err) {
      console.error('Failed to save performance settings:', err);
      setPerfError(
        err instanceof Error
          ? err.message
          : t('settings.network.savePerfFailed'),
      );
    }
  }, [savePerfSettings, t]);

  const handleResetPerfDefaults = useCallback(async () => {
    setPerfError(null);
    try {
      await resetPerfDefaults();
    } catch (err) {
      console.error('Failed to reset performance settings:', err);
      setPerfError(
        err instanceof Error
          ? err.message
          : t('settings.network.savePerfFailed'),
      );
    }
  }, [resetPerfDefaults, t]);

  const tunUnavailable = !!tunCapability && !tunCapability.supported;
  const tunNeedsPrivileges =
    !!tunCapability && tunCapability.supported && !tunCapability.hasPrivileges;
  const tunButtonDisabled = tunUnavailable;
  const networkLocked = isConnected || isConnectionBusy;
  const modeLockedByConnection = networkLocked;

  const modeButtonClass = (active: boolean, disabled: boolean) =>
    clsx(
      'p-4 rounded-xl border text-left transition-all duration-200',
      active
        ? 'border-primary/70 bg-primary/10 text-white'
        : disabled
          ? 'border-gray-800/80 bg-gray-900/30 text-gray-500 cursor-not-allowed opacity-70'
          : 'border-gray-700/50 bg-gray-800/40 text-gray-300 hover:border-gray-600/70',
    );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2.5 mb-1">
        <Shield className="w-4 h-4 text-primary shrink-0" />
        <h3 className="text-sm font-semibold text-gray-200">
          {t('settings.network.mode')}
        </h3>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => handleConnectionModeChange('proxy')}
          disabled={modeLockedByConnection}
          className={modeButtonClass(
            connectionMode === 'proxy',
            modeLockedByConnection,
          )}
        >
          <div className="text-sm font-semibold mb-1">
            {t('settings.network.proxyMode')}
          </div>
          <div className="text-xs text-gray-400 leading-relaxed">
            {t('settings.network.proxyDesc')}
          </div>
        </button>
        <button
          type="button"
          onClick={() => handleConnectionModeChange('tun')}
          disabled={tunButtonDisabled || modeLockedByConnection}
          className={modeButtonClass(
            connectionMode === 'tun',
            tunButtonDisabled || modeLockedByConnection,
          )}
        >
          <div className="text-sm font-semibold mb-1">
            {t('settings.network.tunMode')}
          </div>
          <div className="text-xs text-gray-400 leading-relaxed">
            {t('settings.network.tunDesc')}
          </div>
        </button>
      </div>

      <p className="text-sm text-gray-500 leading-relaxed">
        {t('settings.network.disconnectHint')}
      </p>
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
      {tunCapability?.platform === 'win32' && tunCapability.supported && (
        <div
          className={clsx(
            'rounded-xl border border-gray-700/50 bg-gray-800/30 p-3 space-y-2',
            networkLocked && 'opacity-60 pointer-events-none select-none',
          )}
        >
          <PerfSelectRow
            label={t('settings.network.windowsTunRouting')}
            hint={t('settings.network.windowsTunRoutingHint')}
            value={perfSettings.windowsTunRouting}
            onChange={(v) =>
              updatePerfField('windowsTunRouting', v as WindowsTunRouting)
            }
            options={[
              {
                value: 'xray',
                label: t('settings.network.windowsTunRoutingXray'),
                description: 'autoSystemRoutingTable',
              },
              {
                value: 'powershell',
                label: t('settings.network.windowsTunRoutingPowershell'),
                description: 'Set-NetRoute / DNS',
              },
            ]}
          />
          <p className="text-xs text-gray-500 leading-relaxed">
            {t('settings.network.windowsTunRoutingApplyHint')}
          </p>
        </div>
      )}
      {tunCapability?.degradedReason && (
        <p className="text-sm text-orange-400 leading-relaxed">
          {tunCapability.platform === 'linux'
            ? t('settings.network.tunDegradedLinux')
            : tunCapability.degradedReason}
        </p>
      )}
      {modeError && (
        <p className="text-sm text-orange-400 leading-relaxed">{modeError}</p>
      )}

      <div className="mt-6 pt-6 border-t border-gray-700/50 space-y-4">
        <div className="flex items-center gap-2.5 mb-1">
          <Activity className="w-4 h-4 text-primary shrink-0" />
          <h3 className="text-sm font-semibold text-gray-200">
            {t('settings.network.performance')}
          </h3>
        </div>
        <p className="text-xs text-gray-500 leading-relaxed">
          {t('settings.network.performanceHint')}
        </p>

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
            networkLocked && 'opacity-60 pointer-events-none select-none',
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
            label={t('settings.network.xhttpMaxConnections')}
            hint={t('settings.network.xhttpMaxConnectionsHint')}
            value={perfSettings.xhttpMaxConnections}
            min={1}
            max={16}
            onChange={(v) => updatePerfField('xhttpMaxConnections', v)}
          />

          <PerfSelectRow
            label={t('settings.network.remoteDns')}
            hint={t('settings.network.remoteDnsHint')}
            value={perfSettings.remoteDnsPreset}
            onChange={(v) => {
              const preset = v as RemoteDnsPreset;
              updatePerfField('remoteDnsPreset', preset);
              if (preset !== 'custom') {
                updatePerfField('remoteDnsServers', [
                  ...REMOTE_DNS_PRESET_SERVERS[preset],
                ]);
              }
            }}
            options={[
              {
                value: 'cloudflare',
                label: t('settings.network.remoteDnsCloudflare'),
                description: REMOTE_DNS_PRESET_SERVERS.cloudflare.join(' · '),
              },
              {
                value: 'google',
                label: t('settings.network.remoteDnsGoogle'),
                description: REMOTE_DNS_PRESET_SERVERS.google.join(' · '),
              },
              {
                value: 'quad9',
                label: t('settings.network.remoteDnsQuad9'),
                description: REMOTE_DNS_PRESET_SERVERS.quad9.join(' · '),
              },
              {
                value: 'custom',
                label: t('settings.network.remoteDnsCustom'),
                description:
                  perfSettings.remoteDnsServers.length > 0
                    ? perfSettings.remoteDnsServers.join(' · ')
                    : 'IPv4',
              },
            ]}
          />

          {perfSettings.remoteDnsPreset === 'custom' && (
            <div className="space-y-2 rounded-xl border border-gray-700/40 bg-black/20 p-3">
              <PerfTextRow
                label={t('settings.network.remoteDnsPrimary')}
                hint=""
                value={perfSettings.remoteDnsServers[0] ?? ''}
                placeholder="1.1.1.1"
                onChange={(primary) => {
                  const secondary = perfSettings.remoteDnsServers[1];
                  updatePerfField(
                    'remoteDnsServers',
                    secondary ? [primary, secondary] : [primary],
                  );
                }}
              />
              <PerfTextRow
                label={t('settings.network.remoteDnsSecondary')}
                hint=""
                value={perfSettings.remoteDnsServers[1] ?? ''}
                placeholder="1.0.0.1"
                onChange={(secondary) => {
                  const primary = perfSettings.remoteDnsServers[0] ?? '';
                  updatePerfField(
                    'remoteDnsServers',
                    secondary.trim()
                      ? [primary, secondary]
                      : primary
                        ? [primary]
                        : [],
                  );
                }}
              />
            </div>
          )}

          <PerfNumberRow
            label={t('settings.network.tunMtu')}
            hint={t('settings.network.tunMtuHint')}
            value={perfSettings.tunMtu}
            min={TUN_MTU_MIN}
            max={TUN_MTU_MAX}
            onChange={(v) => updatePerfField('tunMtu', v)}
          />

          <PerfSelectRow
            label={t('settings.network.tunDnsQueryStrategy')}
            hint={t('settings.network.tunDnsQueryStrategyHint')}
            value={perfSettings.tunDnsQueryStrategy}
            onChange={(v) =>
              updatePerfField('tunDnsQueryStrategy', v as TunDnsQueryStrategy)
            }
            options={[
              {
                value: 'UseIPv4',
                label: t('settings.network.tunDnsUseIPv4'),
                description: t('settings.network.tunDnsUseIPv4Desc'),
              },
              {
                value: 'UseIP',
                label: t('settings.network.tunDnsUseIP'),
                description: t('settings.network.tunDnsUseIPDesc'),
              },
              {
                value: 'UseIPv6',
                label: t('settings.network.tunDnsUseIPv6'),
                description: t('settings.network.tunDnsUseIPv6Desc'),
              },
              {
                value: 'UseSystem',
                label: t('settings.network.tunDnsUseSystem'),
                description: t('settings.network.tunDnsUseSystemDesc'),
              },
            ]}
          />

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
            onChange={(v) =>
              updatePerfField('xudpProxyUDP443', v as XudpProxyUDP443)
            }
            options={[
              {
                value: 'reject',
                label: t('settings.network.udp443Reject'),
                description: 'QUIC → TCP',
              },
              {
                value: 'allow',
                label: t('settings.network.udp443Allow'),
                description: 'XUDP mux',
              },
              {
                value: 'skip',
                label: t('settings.network.udp443Skip'),
                description: 'Native UDP',
              },
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
              { value: 'debug', label: 'debug', description: 'Verbose' },
              { value: 'info', label: 'info' },
              { value: 'warning', label: 'warning', description: 'Default' },
              { value: 'error', label: 'error' },
              { value: 'none', label: 'none', description: 'Silent' },
            ]}
          />

          <PerfSelectRow
            label={t('settings.network.fingerprint')}
            hint={t('settings.network.fingerprintHint')}
            value={perfSettings.fingerprint}
            onChange={(v) =>
              updatePerfField('fingerprint', v as TlsFingerprint)
            }
            options={[
              { value: 'chrome', label: 'Chrome', description: 'Default' },
              { value: 'firefox', label: 'Firefox' },
              { value: 'safari', label: 'Safari' },
              { value: 'ios', label: 'iOS' },
              { value: 'android', label: 'Android' },
              { value: 'edge', label: 'Edge' },
              { value: '360', label: '360' },
              { value: 'qq', label: 'QQ' },
              { value: 'random', label: 'Random' },
              {
                value: 'randomized',
                label: 'Randomized',
                description: 'Per connection',
              },
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
            onChange={(v) =>
              updatePerfField('domainStrategy', v as DomainStrategy)
            }
            options={[
              {
                value: 'AsIs',
                label: 'AsIs',
                description: 'No resolve for routing',
              },
              {
                value: 'IPIfNonMatch',
                label: 'IPIfNonMatch',
                description: 'Resolve if no domain rule',
              },
              {
                value: 'IPOnDemand',
                label: 'IPOnDemand',
                description: 'Resolve for IP rules',
              },
            ]}
          />

          <div className="border-t border-gray-700/40 my-1" />

          <div className="space-y-2">
            <div>
              <div className="text-sm text-gray-200">
                {t('settings.network.splitTunnel')}
              </div>
              <div className="text-xs text-gray-500 leading-relaxed mt-0.5">
                {t('settings.network.splitTunnelHint')}
              </div>
            </div>
            <SplitTunnelEditor
              domains={perfSettings.bypassDomains}
              ips={perfSettings.bypassIps}
              disabled={networkLocked}
              onChange={({ domains, ips }) => {
                updatePerfField('bypassDomains', domains);
                updatePerfField('bypassIps', ips);
              }}
            />
            <p className="text-xs text-gray-500 leading-relaxed">
              {t('settings.network.splitTunnelDnsNote')}
            </p>
          </div>
        </fieldset>

        <div className="flex items-center gap-3 pt-2">
          <PrimaryButton
            type="button"
            onClick={handleSavePerfSettings}
            disabled={!perfDirty || perfSaving || networkLocked}
            className="flex-1 disabled:opacity-40"
          >
            {perfSaving && <Loader2 className="w-4 h-4 animate-spin" />}
            {perfDirty ? (
              perfSaving ? (
                t('settings.sources.saving')
              ) : (
                t('settings.network.savePerf')
              )
            ) : (
              <Check className="w-4 h-4" />
            )}
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
        {perfError && (
          <p className="text-sm text-orange-400 leading-relaxed">{perfError}</p>
        )}
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

const PerfToggleRow: React.FC<
  PerfRowProps & { checked: boolean; onChange: (v: boolean) => void }
> = ({ label, hint, checked, onChange }) => (
  <div className="flex items-center justify-between gap-3">
    <PerfLabel label={label} hint={hint} />
    <Toggle checked={checked} onChange={onChange} ariaLabel={label} />
  </div>
);

const PerfNumberRow: React.FC<
  PerfRowProps & {
    value: number;
    min: number;
    max: number;
    onChange: (v: number) => void;
  }
> = ({ label, hint, value, min, max, onChange }) => (
  <div className="flex items-center justify-between gap-3">
    <PerfLabel label={label} hint={hint} />
    <input
      type="number"
      min={min}
      max={max}
      value={value}
      aria-label={label}
      onChange={(e) =>
        onChange(Math.max(min, Math.min(max, parseInt(e.target.value) || min)))
      }
      className="w-20 bg-black/40 border border-gray-600/50 rounded-lg px-2 py-1.5 text-sm text-white text-center focus:border-primary/60 focus:ring-1 focus:ring-primary/20 outline-none"
    />
  </div>
);

const PerfTextRow: React.FC<
  PerfRowProps & {
    value: string;
    placeholder?: string;
    onChange: (v: string) => void;
  }
> = ({ label, hint, value, placeholder, onChange }) => (
  <div className="flex items-center justify-between gap-3">
    <PerfLabel label={label} hint={hint} />
    <input
      type="text"
      value={value}
      placeholder={placeholder}
      aria-label={label}
      onChange={(e) => onChange(e.target.value)}
      className="w-36 bg-black/40 border border-gray-600/50 rounded-lg px-2 py-1.5 text-sm text-white text-center focus:border-primary/60 focus:ring-1 focus:ring-primary/20 outline-none font-mono"
    />
  </div>
);

const PerfSelectRow: React.FC<
  PerfRowProps & {
    value: string;
    onChange: (v: string) => void;
    options: SelectOption[];
  }
> = ({ label, hint, value, onChange, options }) => (
  <div className="flex items-center justify-between gap-3">
    <PerfLabel label={label} hint={hint} />
    <Select
      value={value}
      onChange={onChange}
      options={options}
      ariaLabel={label}
    />
  </div>
);
