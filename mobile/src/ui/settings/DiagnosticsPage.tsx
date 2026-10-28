import React, { useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowLeftRight,
  Ban,
  Check,
  Copy,
  Cpu,
  Plug,
  Power,
  RefreshCw,
  Share2,
  type LucideIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { VlessConfig } from '@/shared/types';
import type { AppSnapshot, ConnectionMonitorEvent } from '@/shared/ipc';
import { PRIMARY_RUNTIME_PORTS } from '@/shared/constants';
import { localizeError } from '@/shared/localizeError';
import { useDiagnosticsActions } from '@/renderer/hooks/useDiagnosticsActions';
import { useFormat } from '../format';
import {
  ErrorText,
  Foot,
  NavChevron,
  Notice,
  PageBody,
  Panel,
  Pill,
  Row,
  RowGroup,
  Switch,
  Tile,
  type Tone,
} from './kit';

const XRAY_TONES: Record<string, Tone> = {
  starting: 'info',
  running: 'ok',
  degraded: 'warn',
  stopping: 'info',
  stopped: 'plain',
  failed: 'bad',
};

const HEALTH_TONES: Record<string, Tone> = {
  idle: 'plain',
  healthy: 'ok',
  degraded: 'warn',
  failed: 'bad',
};

const EVENT_LOOKS: Record<
  ConnectionMonitorEvent['type'],
  { icon: LucideIcon; tone: Tone }
> = {
  connected: { icon: Check, tone: 'ok' },
  switching: { icon: ArrowLeftRight, tone: 'info' },
  blocked: { icon: Ban, tone: 'warn' },
  error: { icon: AlertTriangle, tone: 'bad' },
  disconnected: { icon: Power, tone: 'plain' },
};

interface DiagnosticsPageProps {
  servers: VlessConfig[];
  snapshot: AppSnapshot;
  recentEvents: ConnectionMonitorEvent[];
}

/** Core and connection health, auto-switching and the logs. */
export const DiagnosticsPage: React.FC<DiagnosticsPageProps> = ({
  servers,
  snapshot,
  recentEvents,
}) => {
  const { t, i18n } = useTranslation();
  const format = useFormat();
  const localize = (message: string) => localizeError(message, i18n.language);
  const actions = useDiagnosticsActions();
  const { session, health, process, recovery, autoSwitchingEnabled } = snapshot;
  const [now, setNow] = useState(() => Date.now());

  // Keeps "12 s ago" current.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 5000);
    return () => window.clearInterval(timer);
  }, []);

  const nameOf = (serverId: string) =>
    servers.find((server) => server.uuid === serverId)?.name ??
    t('settings.diagnostics.serverShort', { id: serverId.substring(0, 8) });

  const recoveryState = recovery.recoveryInProgress
    ? { text: t('mobile.settings.diag.recoveryRunning'), tone: 'info' as Tone }
    : recovery.recoveryBlocked
      ? { text: t('mobile.settings.diag.recoveryPaused'), tone: 'warn' as Tone }
      : { text: t('mobile.settings.diag.recoveryIdle'), tone: 'plain' as Tone };

  const failures = [
    session.lastError &&
      `${t('settings.diagnostics.lastError')}: ${localize(session.lastError)}`,
    health.lastHealthFailureReason &&
      `${t('settings.diagnostics.healthFailure')}: ${localize(health.lastHealthFailureReason)}`,
    process.lastFailureReason &&
      `${t('settings.diagnostics.xrayFailure')}: ${localize(process.lastFailureReason)}`,
    recovery.lastFatalReason &&
      `${t('settings.diagnostics.lastFatal')}: ${recovery.lastFatalReason}`,
  ].filter((line): line is string => !!line);

  return (
    <PageBody lead={t('mobile.settings.diag.lead')}>
      <Panel title={t('mobile.settings.diag.state')}>
        <RowGroup>
          <Row
            tile={<Tile icon={Cpu} />}
            label={t('settings.diagnostics.xrayState')}
            hint={
              process.state === 'running' && process.lastStartAt
                ? t('mobile.settings.diag.startedAt', {
                    time: format.clock(process.lastStartAt),
                  })
                : undefined
            }
            trailing={
              <Pill tone={XRAY_TONES[process.state] ?? 'plain'}>
                {t(`mobile.settings.diag.xray.${process.state}`)}
              </Pill>
            }
          />
          <Row
            tile={<Tile icon={Activity} />}
            label={t('settings.diagnostics.lastHealthCheck')}
            hint={
              health.lastHealthCheckAt
                ? t('mobile.settings.diag.checkedAgo', {
                    ago: format.ago(now - health.lastHealthCheckAt),
                  })
                : t('mobile.settings.diag.notChecked')
            }
            trailing={
              <Pill tone={HEALTH_TONES[health.lastHealthState] ?? 'plain'}>
                {t(`mobile.settings.diag.health.${health.lastHealthState}`)}
              </Pill>
            }
          />
          <Row
            tile={<Tile icon={Plug} />}
            label={t('mobile.settings.diag.localProxy')}
            hint={`127.0.0.1:${PRIMARY_RUNTIME_PORTS.socks} · ${PRIMARY_RUNTIME_PORTS.http}`}
            trailing={
              <Pill
                tone={
                  health.localProxyReachable == null
                    ? 'plain'
                    : health.localProxyReachable
                      ? 'ok'
                      : 'bad'
                }
              >
                {health.localProxyReachable == null
                  ? '—'
                  : t(
                      health.localProxyReachable
                        ? 'mobile.settings.diag.proxyReachable'
                        : 'mobile.settings.diag.proxyUnreachable',
                    )}
              </Pill>
            }
          />
          <Row
            tile={<Tile icon={RefreshCw} />}
            label={t('mobile.settings.diag.recovery')}
            hint={t('mobile.settings.diag.attempts', {
              count: recovery.recoveryAttemptCount,
            })}
            trailing={
              <Pill tone={recoveryState.tone}>{recoveryState.text}</Pill>
            }
          />
        </RowGroup>
        {failures.length > 0 && (
          <Notice tone="warn">
            {failures.map((line) => (
              <span key={line} className="block">
                {line}
              </span>
            ))}
          </Notice>
        )}
      </Panel>

      <Panel title={t('settings.diagnostics.monitoring')}>
        <RowGroup>
          <Row
            label={t('settings.diagnostics.autoSwitching')}
            hint={t('settings.diagnostics.autoSwitchingDesc')}
            trailing={
              <Switch
                checked={autoSwitchingEnabled}
                onChange={(enabled) =>
                  void actions.toggleAutoSwitching(enabled)
                }
                label={t('settings.diagnostics.autoSwitching')}
              />
            }
          />
          {session.blockedServerIds.length > 0 && (
            <Row
              label={t('mobile.settings.diag.blocked', {
                count: session.blockedServerIds.length,
              })}
              hint={t('mobile.settings.diag.blockedHint', {
                names: session.blockedServerIds.map(nameOf).join(', '),
              })}
              trailing={
                <button
                  type="button"
                  onClick={() => void actions.clearBlocked()}
                  className="shrink-0 h-9 px-3.5 rounded-[10px] border border-line2 bg-s2 text-fg text-sm leading-4 font-medium whitespace-nowrap"
                >
                  {t('settings.diagnostics.clear')}
                </button>
              }
            />
          )}
        </RowGroup>
      </Panel>

      {recentEvents.length > 0 && (
        <Panel title={t('settings.diagnostics.recentEvents')}>
          <RowGroup>
            {recentEvents.map((event, index) => {
              const look = EVENT_LOOKS[event.type] ?? EVENT_LOOKS.error;
              const label =
                (event.message && localize(event.message)) ||
                t(`settings.diagnostics.eventTypes.${event.type}`, {
                  defaultValue: event.type,
                });
              const server = event.server?.name;
              return (
                <Row
                  key={index}
                  tile={<Tile icon={look.icon} tone={look.tone} />}
                  label={label}
                  wrap
                  hint={server && !label.includes(server) ? server : undefined}
                />
              );
            })}
          </RowGroup>
        </Panel>
      )}

      <Panel
        title={t('mobile.settings.diag.logs')}
        foot={<Foot>{t('settings.diagnostics.sanitizedHint')}</Foot>}
      >
        <RowGroup>
          <Row
            tile={
              <Tile
                icon={actions.copied ? Check : Copy}
                tone={actions.copied ? 'ok' : undefined}
              />
            }
            label={
              actions.copied
                ? t('settings.diagnostics.copied')
                : t('settings.diagnostics.copyLogs')
            }
            hint={t('mobile.settings.diag.copyHint')}
            trailing={<NavChevron />}
            onClick={() => void actions.copyLogs()}
          />
          <Row
            tile={<Tile icon={Share2} />}
            label={t('settings.diagnostics.openFolder')}
            hint={t('mobile.settings.diag.shareHint')}
            trailing={<NavChevron />}
            onClick={actions.openLogFolder}
          />
        </RowGroup>
        {actions.copyError && <ErrorText>{actions.copyError}</ErrorText>}
      </Panel>
    </PageBody>
  );
};
