import React, { useEffect, useState } from 'react';
import clsx from 'clsx';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Clock,
  RefreshCw,
  Route,
  XCircle,
  type LucideIcon,
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
  type AppSnapshot,
  type SessionPhase,
  type TrafficSnapshot,
} from '@/shared/ipc';
import { localizeError } from '@/shared/localizeError';
import { Dial, type DialState } from '@/renderer/components/Dial';
import { Button, TONES, type Tone } from '@/renderer/components/ui';
import {
  describeServer,
  describeTransport,
  PingBadge,
  ServerFlag,
} from '@/renderer/components/servers/serverParts';
import { formatDuration, useFormat } from '@/renderer/hooks/useFormat';
import { useSessionDuration } from '@/renderer/hooks/useSessionDuration';
import { useNow } from '@/renderer/hooks/useNow';
import { useDiagnosticsActions } from '@/renderer/hooks/useDiagnosticsActions';

interface StageProps {
  snapshot: AppSnapshot;
  selectedServer: VlessConfig | null;
  connectionError: string | null;
  isConnectionBusy: boolean;
  onToggleConnection: () => void;
  onModeChange: (mode: ConnectionMode) => void;
  onOpenRouting: () => void;
  onOpenDiagnostics: () => void;
}

/** "No default route" from main: the computer has no network at all. */
const OFFLINE_ERROR = /Could not get default route/;
/** TUN needs elevation that was refused; proxy mode needs none. */
const RIGHTS_ERROR = /requires Administrator rights|needs elevated privileges/;

/** Routing settings for the summary chip; read again on every phase change. */
function useRoutingSettings(phase: SessionPhase): PerformanceSettings | null {
  const [settings, setSettings] = useState<PerformanceSettings | null>(null);
  useEffect(() => {
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
  }, [phase]);
  return settings;
}

/**
 * The right side of the home window: the ring and what the core reports
 * about the session — nothing the snapshot does not hold.
 */
export const Stage: React.FC<StageProps> = ({
  snapshot,
  selectedServer,
  connectionError,
  isConnectionBusy,
  onToggleConnection,
  onModeChange,
  onOpenRouting,
  onOpenDiagnostics,
}) => {
  const { t, i18n } = useTranslation();
  const format = useFormat();
  const [details, setDetails] = useState(false);
  const { session, connectionMode, process, health, recovery } = snapshot;
  const phase = session.phase;
  const trafficSnapshot = snapshot.traffic;
  const durationMs = useSessionDuration(trafficSnapshot);
  const routing = useRoutingSettings(phase);
  const now = useNow(5_000);

  const connected = phase === 'connected';
  const inFlight = isSessionPhaseInFlight(phase);
  const tun = connectionMode === 'tun';
  const error = inFlight || connected ? null : connectionError;
  const offline = phase === 'failed' && !!error && OFFLINE_ERROR.test(error);
  const dialState: DialState = offline ? 'offline' : phase;
  // The core is up and the session waits for its first verified check.
  const step = process.state === 'running' ? 1 : 0;

  const dial = (() => {
    switch (dialState) {
      case 'connecting':
        return {
          label: t('dial.connecting'),
          sub: t(step === 0 ? 'dial.subStarting' : 'dial.subVerifying'),
          aria: t('dial.ariaCancel'),
        };
      case 'connected':
        return {
          label: t('dial.connected'),
          sub: trafficSnapshot ? formatDuration(durationMs) : '',
          aria: t('dial.ariaDisconnect'),
        };
      case 'switching':
        return {
          label: t('dial.switching'),
          sub: t('dial.subSwitching'),
          aria: t('dial.ariaCancelSwitch'),
        };
      case 'disconnecting':
        return {
          label: t('dial.disconnecting'),
          sub: t('dial.subDisconnecting'),
          aria: t('dial.disconnecting'),
        };
      case 'failed':
        return {
          label: t('dial.failed'),
          sub: t('dial.subFailed'),
          aria: t('dial.ariaRetry'),
        };
      case 'offline':
        return {
          label: t('dial.offline'),
          sub: t('dial.subOffline'),
          aria: t('dial.ariaConnect'),
        };
      default:
        return {
          label: t('dial.idle'),
          sub: t('dial.subIdle'),
          aria: t('dial.ariaConnect'),
        };
    }
  })();
  const dialDisabled =
    (inFlight && !isSessionPhaseCancellable(phase)) ||
    (!selectedServer && !connected && !inFlight);

  const hint = offline
    ? t('home.offlineHint')
    : phase === 'idle'
      ? selectedServer
        ? t(tun ? 'settings.network.tunDesc' : 'settings.network.proxyDesc')
        : t('status.selectServer')
      : phase === 'switching'
        ? t('status.cancelSwitchHint')
        : phase === 'disconnecting'
          ? t('status.disconnectingHint')
          : '';

  const routingSummary = routing
    ? [
        t(
          routing.routingMode === 'sites'
            ? 'home.routingSites'
            : routing.routingMode === 'apps'
              ? 'home.routingApps'
              : 'home.routingAll',
        ),
        routing.bypassDomains.length + routing.bypassIps.length > 0
          ? t('count.exclusions', {
              count: routing.bypassDomains.length + routing.bypassIps.length,
            })
          : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : null;

  return (
    <div className="flex-[1_0_auto] flex flex-col items-center justify-center gap-5 p-8">
      <Dial
        phase={dialState}
        size={232}
        label={dial.label}
        sub={dial.sub}
        subMono={connected}
        ariaLabel={dial.aria}
        disabled={dialDisabled}
        onPress={onToggleConnection}
      />

      {selectedServer && (
        <div className="max-w-full flex flex-col items-center gap-1 text-center">
          <div className="max-w-full flex items-center gap-2.5">
            <ServerFlag server={selectedServer} size={22} />
            <h1
              className="m-0 min-w-0 text-[22px] leading-7 font-semibold tracking-[-0.02em] truncate"
              title={selectedServer.name}
            >
              {selectedServer.name}
            </h1>
          </div>
          <div data-selectable className="font-mono text-xs leading-4 text-fg3">
            {selectedServer.address}:{selectedServer.port}
          </div>
        </div>
      )}

      {selectedServer && (
        <div className="-mt-1 flex flex-wrap justify-center gap-2">
          <PingBadge server={selectedServer} large />
          <span className="h-7 box-border inline-flex items-center px-2.5 rounded-lg bg-s1 border border-line text-xs leading-4 font-medium text-fg2">
            {describeServer(selectedServer)}
          </span>
          {routingSummary && (
            <button
              type="button"
              onClick={onOpenRouting}
              aria-label={t('home.routingAria', { summary: routingSummary })}
              className="h-7 box-border inline-flex items-center gap-1.5 px-2.5 rounded-lg bg-s1 border border-line text-xs leading-4 font-medium text-fg2 hover:text-fg hover:bg-s2"
            >
              <Route aria-hidden strokeWidth={1.75} className="w-3.5 h-3.5" />
              {routingSummary}
            </button>
          )}
        </div>
      )}

      {hint && (
        <p
          role="status"
          aria-live="polite"
          className="m-0 max-w-[400px] text-center text-[13px] leading-5 text-fg2"
        >
          {hint}
        </p>
      )}

      {phase === 'connecting' && <ConnectSteps current={step} />}

      {connected && trafficSnapshot && (
        <>
          <SessionStats traffic={trafficSnapshot} durationMs={durationMs} />
          <button
            type="button"
            aria-expanded={details}
            onClick={() => setDetails((open) => !open)}
            className="-mt-2 h-7 inline-flex items-center gap-1 px-2 rounded-md text-fg2 text-xs leading-4 font-normal hover:bg-s2 hover:text-fg"
          >
            {t('home.details')}
            <ChevronDown
              aria-hidden
              strokeWidth={2}
              className={clsx(
                'w-3.5 h-3.5 transition-transform duration-200',
                details && 'rotate-180',
              )}
            />
          </button>
          {details && selectedServer && (
            <dl className="-mt-2 mb-0 w-full max-w-[480px] grid grid-cols-2 gap-x-6">
              {[
                {
                  k: t('home.detailMode'),
                  v: t(tun ? 'shell.modeTun' : 'shell.modeProxy'),
                },
                {
                  k: t('home.detailTransport'),
                  v: describeTransport(selectedServer),
                },
                {
                  k: t('home.detailCore'),
                  v: t(`pages.diag.xray.${process.state}`),
                },
                {
                  k: t('home.detailCheck'),
                  v: health.lastHealthCheckAt
                    ? t('home.ago', {
                        ago: format.ago(now - health.lastHealthCheckAt),
                      })
                    : t('home.notChecked'),
                },
              ].map((row) => (
                <div
                  key={row.k}
                  className="h-8 flex items-center justify-between gap-3 border-b border-line"
                >
                  <dt className="text-xs leading-4 text-fg3">{row.k}</dt>
                  <dd className="m-0 text-xs leading-4 font-medium text-fg text-right truncate">
                    {row.v}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </>
      )}

      {inFlight && recovery.recoveryInProgress && (
        <StageCard
          tone="info"
          icon={RefreshCw}
          title={t('home.recovering', {
            count: Math.max(1, recovery.recoveryAttemptCount),
          })}
          body={
            recovery.lastRecoveryReason
              ? localizeError(recovery.lastRecoveryReason, i18n.language)
              : undefined
          }
          secondary={{
            label: t('shell.disconnect'),
            onClick: onToggleConnection,
          }}
        />
      )}

      {error && !offline && (
        <ErrorCard
          error={error}
          recoveryStopped={
            phase === 'failed' && recovery.recoveryBlocked
              ? recovery.recoveryAttemptCount
              : null
          }
          canSwitchToProxy={tun && RIGHTS_ERROR.test(error)}
          busy={isConnectionBusy}
          onRetry={onToggleConnection}
          onProxy={() => onModeChange('proxy')}
          onDiagnostics={onOpenDiagnostics}
        />
      )}
    </div>
  );
};

const STEP_KEYS = ['steps.core', 'steps.tunnel', 'steps.secure'];

const ConnectSteps: React.FC<{ current: number }> = ({ current }) => {
  const { t } = useTranslation();
  return (
    <ol
      aria-label={t('steps.aria')}
      className="m-0 p-0 list-none flex flex-wrap justify-center items-center gap-4"
    >
      {STEP_KEYS.map((key, index) => {
        const done = index < current;
        const active = index === current;
        return (
          <li
            key={key}
            aria-current={active ? 'step' : undefined}
            className={clsx(
              'inline-flex items-center gap-1.5 text-xs leading-4 font-medium',
              active ? 'text-fg' : done ? 'text-fg2' : 'text-fg3',
            )}
          >
            <span
              className={clsx(
                'w-1.5 h-1.5 rounded-full transition-colors duration-200',
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
        ? t('home.since', { time: format.clock(traffic.connectedAt) })
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
      className="w-full max-w-[480px] grid grid-cols-3 rounded-xl bg-s1 border border-line shadow-panel"
    >
      {cells.map(({ icon: Icon, iconClass, label, value, sub }, index) => (
        <div
          key={label}
          className={clsx(
            'min-w-0 px-4 py-3 flex flex-col gap-1.5',
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

interface CardAction {
  label: string;
  onClick: () => void;
}

const StageCard: React.FC<{
  tone: Tone;
  icon: LucideIcon;
  title: string;
  body?: string;
  primary?: CardAction;
  secondary?: CardAction;
  disabled?: boolean;
  onDiagnostics?: () => void;
}> = ({
  tone,
  icon: Icon,
  title,
  body,
  primary,
  secondary,
  disabled,
  onDiagnostics,
}) => {
  const { t } = useTranslation();
  return (
    <div
      role={tone === 'info' ? 'status' : 'alert'}
      className={clsx(
        'w-full max-w-[480px] box-border flex gap-3 p-4 rounded-xl border page-in',
        TONES[tone],
      )}
    >
      <Icon aria-hidden strokeWidth={2} className="w-4 h-4 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0 flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-start gap-3">
            <span
              data-selectable
              className="flex-1 min-w-0 text-sm leading-5 font-semibold text-fg break-words"
            >
              {title}
            </span>
            {onDiagnostics && (
              <button
                type="button"
                onClick={onDiagnostics}
                className="shrink-0 h-5 inline-flex items-center gap-0.5 text-xs leading-4 font-medium text-acc whitespace-nowrap hover:underline"
              >
                {t('settings.tabs.diagnostics')}
                <ChevronRight
                  aria-hidden
                  strokeWidth={2}
                  className="w-3.5 h-3.5"
                />
              </button>
            )}
          </div>
          {body && (
            <span
              data-selectable
              className="text-[13px] leading-5 text-fg2 break-words"
            >
              {body}
            </span>
          )}
        </div>
        {(primary || secondary) && (
          <div className="flex flex-wrap items-center gap-2">
            {primary && (
              <Button
                variant="primary"
                onClick={primary.onClick}
                disabled={disabled}
              >
                {primary.label}
              </Button>
            )}
            {secondary && (
              <Button onClick={secondary.onClick}>{secondary.label}</Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const ErrorCard: React.FC<{
  error: string;
  /** Attempts made before recovery gave up, when it did. */
  recoveryStopped: number | null;
  canSwitchToProxy: boolean;
  busy: boolean;
  onRetry: () => void;
  onProxy: () => void;
  onDiagnostics: () => void;
}> = ({
  error,
  recoveryStopped,
  canSwitchToProxy,
  busy,
  onRetry,
  onProxy,
  onDiagnostics,
}) => {
  const { t, i18n } = useTranslation();
  const { copied, copyLogs } = useDiagnosticsActions();
  const message = localizeError(error, i18n.language);
  const stopped = recoveryStopped !== null;
  return (
    <StageCard
      tone={stopped ? 'bad' : 'warn'}
      icon={stopped ? XCircle : AlertTriangle}
      title={
        stopped
          ? t('home.recoveryStopped', { count: recoveryStopped })
          : message
      }
      body={stopped ? t('home.lastReason', { reason: message }) : undefined}
      primary={{ label: t('home.retry'), onClick: onRetry }}
      secondary={
        canSwitchToProxy
          ? { label: t('home.toProxy'), onClick: onProxy }
          : {
              label: copied ? t('home.copied') : t('home.copyLogs'),
              onClick: () => void copyLogs(),
            }
      }
      disabled={busy}
      onDiagnostics={onDiagnostics}
    />
  );
};
