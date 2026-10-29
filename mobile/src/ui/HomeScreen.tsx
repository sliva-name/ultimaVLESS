import React, { useCallback, useEffect, useState } from 'react';
import clsx from 'clsx';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ChevronRight,
  Clock,
  Layers,
  Plus,
  Route,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type {
  ConnectionMode,
  PerformanceSettings,
  VlessConfig,
} from '@/shared/types';
import {
  isSessionPhaseCancellable,
  isSessionPhaseInFlight,
  type SessionPhase,
  type TrafficSnapshot,
  type XrayHealthState,
} from '@/shared/ipc';
import { localizeError } from '@/shared/localizeError';
import logoUrl from '@/renderer/assets/logo.svg';
import { Dial } from '@/renderer/components/Dial';
import { UpdateCard } from './UpdateCard';
import { formatDuration, useFormat } from '@/renderer/hooks/useFormat';
import { useSessionDuration } from '@/renderer/hooks/useSessionDuration';
import { describeServer, PingBadge, ServerFlag } from './serverParts';
import type { MobileRoute, SettingsPage } from './useMobileNav';

interface HomeScreenProps {
  phase: SessionPhase;
  processState: XrayHealthState;
  connectionMode: ConnectionMode;
  isConnectionBusy: boolean;
  selectedServer: VlessConfig | null;
  hasServers: boolean;
  connectionError: string | null;
  trafficSnapshot: TrafficSnapshot | null;
  onToggleConnection: () => void;
  onOpenServers: () => void;
  onOpenSettings: (page: SettingsPage, extra?: Partial<MobileRoute>) => void;
}

const MODES: { mode: ConnectionMode; labelKey: string }[] = [
  { mode: 'tun', labelKey: 'mobile.modeVpn' },
  { mode: 'proxy', labelKey: 'mobile.modeProxy' },
];

/** VPN / proxy-only switch; a connected session restarts in the new mode. */
const ModeSwitch: React.FC<{
  mode: ConnectionMode;
  disabled: boolean;
  onError: (message: string | null) => void;
}> = ({ mode, disabled, onError }) => {
  const { t } = useTranslation();
  const [pending, setPending] = useState<ConnectionMode | null>(null);

  const choose = useCallback(
    async (next: ConnectionMode) => {
      if (next === mode || disabled) return;
      onError(null);
      setPending(next);
      try {
        await window.electronAPI.setConnectionMode(next);
      } catch (error) {
        onError(error instanceof Error ? error.message : String(error));
      } finally {
        setPending(null);
      }
    },
    [mode, disabled, onError],
  );

  const shown = pending ?? mode;
  return (
    <div
      role="radiogroup"
      aria-label={t('mobile.modeAria')}
      className="h-10 shrink-0 flex p-[3px] rounded-xl bg-s2 border border-line"
    >
      {MODES.map(({ mode: option, labelKey }) => {
        const on = shown === option;
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            onClick={() => void choose(option)}
            className={clsx(
              'h-8 px-3.5 rounded-[9px] text-[13px] leading-4 font-medium transition-colors duration-150 disabled:opacity-50',
              on ? 'bg-thumb text-fg shadow-thumb' : 'text-fg2',
            )}
          >
            {t(labelKey)}
          </button>
        );
      })}
    </div>
  );
};

/** Routing settings for the summary chip; read again on every connect. */
function useRoutingSummary(phase: SessionPhase): PerformanceSettings | null {
  const [settings, setSettings] = useState<PerformanceSettings | null>(null);
  const connected = phase === 'connected';
  useEffect(() => {
    if (!connected) return;
    let disposed = false;
    window.electronAPI
      .getPerformanceSettings()
      .then((next) => {
        if (!disposed) setSettings(next);
      })
      .catch((err) => console.error('Failed to load routing settings:', err));
    return () => {
      disposed = true;
    };
  }, [connected]);
  return settings;
}

const STEP_KEYS = [
  'mobile.steps.core',
  'mobile.steps.tunnel',
  'mobile.steps.secure',
];

const ConnectSteps: React.FC<{ current: number }> = ({ current }) => {
  const { t } = useTranslation();
  return (
    <ol
      aria-label={t('mobile.steps.aria')}
      className="m-0 p-0 list-none flex flex-wrap justify-center items-center gap-x-4 gap-y-2"
    >
      {STEP_KEYS.map((key, index) => {
        const done = index < current;
        const active = index === current;
        return (
          <li
            key={key}
            aria-current={active ? 'step' : undefined}
            className={clsx(
              'inline-flex items-center gap-1.5 text-[13px] leading-4 font-medium',
              active ? 'text-fg' : done ? 'text-fg2' : 'text-fg3',
            )}
          >
            <span
              className={clsx(
                'w-1.5 h-1.5 rounded-full',
                done ? 'bg-ok' : active ? 'bg-acc' : 'bg-dim',
                active && 'shadow-[0_0_0_3px_var(--color-acc-soft)]',
              )}
            />
            {t(key)}
          </li>
        );
      })}
    </ol>
  );
};

/** Android errors the card can offer a second way out of. */
function secondaryAction(error: string): 'proxy' | 'server' | null {
  if (/VPN permission was denied/.test(error)) return 'proxy';
  if (/VPN service stopped/.test(error)) return 'server';
  return null;
}

const ErrorCard: React.FC<{
  error: string;
  onRetry: () => void;
  onProxyOnly: () => void;
  onOtherServer: () => void;
  onDiagnostics: () => void;
}> = ({ error, onRetry, onProxyOnly, onOtherServer, onDiagnostics }) => {
  const { t, i18n } = useTranslation();
  const secondary = secondaryAction(error);
  return (
    <div
      role="alert"
      className="flex gap-3 p-4 rounded-2xl bg-warn-soft border border-warn-line"
    >
      <AlertTriangle
        aria-hidden
        strokeWidth={2}
        className="w-[18px] h-[18px] shrink-0 mt-px text-warn"
      />
      <div className="flex-1 min-w-0 flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <span className="flex-1 min-w-0 text-[15px] leading-5 font-semibold break-words">
            {localizeError(error, i18n.language)}
          </span>
          <button
            type="button"
            onClick={onDiagnostics}
            className="shrink-0 h-5 inline-flex items-center gap-0.5 text-[13px] leading-4 font-medium text-acc whitespace-nowrap"
          >
            {t('settings.tabs.diagnostics')}
            <ChevronRight aria-hidden strokeWidth={2} className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onRetry}
            className="h-10 px-4 rounded-[10px] bg-acc-fill text-white text-sm leading-4 font-medium"
          >
            {t('mobile.home.retry')}
          </button>
          {secondary && (
            <button
              type="button"
              onClick={secondary === 'proxy' ? onProxyOnly : onOtherServer}
              className="h-10 px-4 rounded-[10px] border border-line2 text-fg text-sm leading-4 font-medium"
            >
              {secondary === 'proxy'
                ? t('settings.network.proxyMode')
                : t('mobile.home.otherServer')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

const SessionStats: React.FC<{
  traffic: TrafficSnapshot;
  durationMs: number;
}> = ({ traffic, durationMs }) => {
  const { t } = useTranslation();
  const format = useFormat();
  const cells = [
    {
      icon: Clock,
      iconClass: 'text-fg3',
      label: t('status.session.duration'),
      value: format.duration(durationMs),
      sub: traffic.connectedAt
        ? t('mobile.home.since', { time: format.clock(traffic.connectedAt) })
        : '',
    },
    {
      icon: ArrowDown,
      iconClass: 'text-acc',
      label: t('status.session.download'),
      value: format.bytes(traffic.downloadBytes),
      sub: format.rate(traffic.downloadBps),
    },
    {
      icon: ArrowUp,
      iconClass: 'text-violet',
      label: t('status.session.upload'),
      value: format.bytes(traffic.uploadBytes),
      sub: format.rate(traffic.uploadBps),
    },
  ];
  return (
    <div
      aria-label={t('status.session.label')}
      className="grid grid-cols-3 rounded-2xl bg-s1 border border-line"
    >
      {cells.map(({ icon: Icon, iconClass, label, value, sub }, index) => (
        <div
          key={label}
          className={clsx(
            'min-w-0 px-3.5 py-3 flex flex-col gap-1.5',
            index > 0 && 'border-l border-line',
          )}
        >
          <span className="flex items-center gap-1.5 text-xs leading-4 text-fg3 whitespace-nowrap">
            <Icon
              aria-hidden
              strokeWidth={2.25}
              className={clsx('w-3 h-3 shrink-0', iconClass)}
            />
            <span className="truncate">{label}</span>
          </span>
          <span className="flex flex-col gap-0.5 min-w-0">
            <span className="font-mono text-[15px] leading-5 font-medium tabular-nums whitespace-nowrap truncate">
              {value}
            </span>
            <span className="text-xs leading-4 text-fg2 tabular-nums whitespace-nowrap truncate">
              {sub}
            </span>
          </span>
        </div>
      ))}
    </div>
  );
};

const EmptyState: React.FC<{
  onAddSubscription: () => void;
  onPasteLinks: () => void;
}> = ({ onAddSubscription, onPasteLinks }) => {
  const { t } = useTranslation();
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex-1 flex flex-col items-center justify-center gap-5 px-3 text-center">
        <span
          aria-hidden="true"
          className="w-16 h-16 rounded-[20px] flex items-center justify-center bg-s2 border border-line text-fg2"
        >
          <Layers strokeWidth={1.75} className="w-7 h-7" />
        </span>
        <div className="flex flex-col gap-2">
          <h1 className="m-0 text-xl leading-7 font-semibold tracking-[-0.01em]">
            {t('mobile.empty.title')}
          </h1>
          <p className="m-0 text-sm leading-5 text-fg2">
            {t('mobile.empty.body')}
          </p>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={onAddSubscription}
          className="h-12 flex items-center justify-center gap-2 rounded-xl bg-acc-fill text-white text-[15px] leading-5 font-medium"
        >
          <Plus aria-hidden strokeWidth={2} className="w-[18px] h-[18px]" />
          {t('settings.sources.addSubscription')}
        </button>
        <button
          type="button"
          onClick={onPasteLinks}
          className="h-12 flex items-center justify-center rounded-xl border border-line2 text-fg text-[15px] leading-5 font-medium"
        >
          {t('mobile.empty.pasteLinks')}
        </button>
      </div>
    </div>
  );
};

/** Smaller ring on short screens, so the server card stays in view. */
function useDialSize(): number {
  const pick = () =>
    window.innerHeight >= 820 ? 232 : window.innerHeight >= 700 ? 216 : 192;
  const [size, setSize] = useState(pick);
  useEffect(() => {
    const onResize = () => setSize(pick());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return size;
}

export const HomeScreen: React.FC<HomeScreenProps> = ({
  phase,
  processState,
  connectionMode,
  isConnectionBusy,
  selectedServer,
  hasServers,
  connectionError,
  trafficSnapshot,
  onToggleConnection,
  onOpenServers,
  onOpenSettings,
}) => {
  const { t } = useTranslation();
  const [modeError, setModeError] = useState<string | null>(null);
  const durationMs = useSessionDuration(trafficSnapshot);
  const routing = useRoutingSummary(phase);
  const dialSize = useDialSize();

  const connected = phase === 'connected';
  const inFlight = isSessionPhaseInFlight(phase);
  const vpn = connectionMode === 'tun';
  // The core is up and the session waits for its first verified check.
  const step = processState === 'running' ? 1 : 0;
  const error = modeError ?? (inFlight || connected ? null : connectionError);

  const dial = (() => {
    switch (phase) {
      case 'connecting':
        return {
          label: t('mobile.dial.connecting'),
          sub: t(
            step === 0 ? 'mobile.dial.subStarting' : 'mobile.dial.subVerifying',
          ),
          aria: t('mobile.dial.ariaCancel'),
        };
      case 'connected':
        return {
          label: t('mobile.dial.connected'),
          sub: trafficSnapshot ? formatDuration(durationMs) : '',
          aria: t('mobile.disconnect'),
        };
      case 'switching':
        return {
          label: t('mobile.dial.switching'),
          sub: t('mobile.dial.subSwitching'),
          aria: t('mobile.dial.ariaCancelSwitch'),
        };
      case 'disconnecting':
        return {
          label: t('mobile.dial.disconnecting'),
          sub: t('mobile.dial.subDisconnecting'),
          aria: t('mobile.dial.disconnecting'),
        };
      case 'failed':
        return {
          label: t('mobile.dial.failed'),
          sub: t('mobile.dial.subFailed'),
          aria: t('mobile.home.retry'),
        };
      default:
        return {
          label: t('mobile.dial.idle'),
          sub: t('mobile.dial.subIdle'),
          aria: t('mobile.connect'),
        };
    }
  })();
  const dialDisabled =
    (inFlight && !isSessionPhaseCancellable(phase)) ||
    (!selectedServer && !connected && !inFlight);

  // Without a server the card below already says to pick one.
  const hint =
    phase === 'idle'
      ? selectedServer
        ? t(vpn ? 'settings.network.tunDesc' : 'settings.network.proxyDesc')
        : ''
      : phase === 'switching'
        ? t('status.cancelSwitchHint')
        : phase === 'disconnecting'
          ? t('status.disconnectingHint')
          : '';

  const routingChip = routing
    ? [
        t(
          routing.routingMode === 'sites'
            ? 'mobile.settings.routingSites'
            : routing.routingMode === 'apps'
              ? 'mobile.settings.routingApps'
              : 'mobile.settings.routingAll',
        ),
        routing.bypassDomains.length + routing.bypassIps.length > 0
          ? t('mobile.count.exclusions', {
              count: routing.bypassDomains.length + routing.bypassIps.length,
            })
          : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : null;

  const switchToProxy = useCallback(() => {
    setModeError(null);
    window.electronAPI.setConnectionMode('proxy').catch((err: unknown) => {
      setModeError(err instanceof Error ? err.message : String(err));
    });
  }, []);

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <header className="h-14 shrink-0 flex items-center gap-2.5 px-4">
        <img src={logoUrl} alt="" className="w-7 h-7 shrink-0 rounded-[7px]" />
        <span className="flex-1 min-w-0 text-lg leading-6 font-semibold tracking-[-0.01em] whitespace-nowrap truncate">
          {t('app.title')}
        </span>
        <ModeSwitch
          mode={connectionMode}
          disabled={isConnectionBusy}
          onError={setModeError}
        />
      </header>

      <UpdateCard className="mx-4 mb-1" />

      <main className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
        <div className="min-h-full flex flex-col px-4 pb-4">
          {!hasServers ? (
            <EmptyState
              onAddSubscription={() =>
                onOpenSettings('sources', { sheet: true })
              }
              onPasteLinks={() => onOpenSettings('sources')}
            />
          ) : (
            <div className="flex-1 flex flex-col gap-3">
              <div className="flex-1 flex flex-col items-center justify-center gap-3">
                <Dial
                  phase={phase}
                  size={dialSize}
                  label={dial.label}
                  sub={dial.sub}
                  subMono={connected}
                  ariaLabel={dial.aria}
                  disabled={dialDisabled}
                  onPress={onToggleConnection}
                />

                {(connected || phase === 'switching') && selectedServer && (
                  <div className="flex flex-wrap justify-center gap-2">
                    <span className="h-8 inline-flex items-center px-3 rounded-[10px] bg-s1 border border-line text-[13px] leading-4 font-medium text-fg2">
                      {describeServer(selectedServer)}
                    </span>
                    {routingChip && (
                      <button
                        type="button"
                        onClick={() => onOpenSettings('routing')}
                        className="h-8 inline-flex items-center gap-1.5 px-3 rounded-[10px] bg-s1 border border-line text-[13px] leading-4 font-medium text-fg2"
                      >
                        <Route
                          aria-hidden
                          strokeWidth={1.75}
                          className="w-4 h-4"
                        />
                        {routingChip}
                      </button>
                    )}
                  </div>
                )}

                {connected && !vpn && (
                  <span className="font-mono text-xs leading-4 text-fg2 text-center">
                    {t('mobile.proxyEndpoints')}
                  </span>
                )}

                {phase === 'connecting' && <ConnectSteps current={step} />}

                {hint && !error && (
                  <p
                    role="status"
                    className="m-0 max-w-80 text-center text-[13px] leading-5 text-fg2"
                  >
                    {hint}
                  </p>
                )}
              </div>

              <div className="shrink-0 flex flex-col gap-3">
                {error && (
                  <ErrorCard
                    error={error}
                    onRetry={() => {
                      setModeError(null);
                      onToggleConnection();
                    }}
                    onProxyOnly={switchToProxy}
                    onOtherServer={onOpenServers}
                    onDiagnostics={() => onOpenSettings('diag')}
                  />
                )}

                <button
                  type="button"
                  onClick={onOpenServers}
                  aria-label={
                    selectedServer
                      ? t('mobile.home.serverAria', {
                          name: selectedServer.name,
                        })
                      : t('status.selectServer')
                  }
                  className="h-[72px] flex items-center gap-3 pl-4 pr-2 rounded-2xl bg-s1 border border-line text-left"
                >
                  {selectedServer && (
                    <ServerFlag server={selectedServer} size={32} />
                  )}
                  <span className="flex-1 min-w-0 flex flex-col gap-0.5">
                    <span className="text-base leading-[22px] font-semibold truncate">
                      {selectedServer?.name ?? t('status.selectServer')}
                    </span>
                    {selectedServer && (
                      <span className="font-mono text-xs leading-4 text-fg3 truncate">
                        {selectedServer.address}:{selectedServer.port}
                      </span>
                    )}
                  </span>
                  {selectedServer && <PingBadge server={selectedServer} />}
                  <ChevronRight
                    aria-hidden
                    strokeWidth={2}
                    className="w-5 h-5 shrink-0 text-fg3"
                  />
                </button>

                {connected && trafficSnapshot && (
                  <SessionStats
                    traffic={trafficSnapshot}
                    durationMs={durationMs}
                  />
                )}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};
