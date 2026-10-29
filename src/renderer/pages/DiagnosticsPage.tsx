import React, { useEffect } from 'react';
import {
  Activity,
  AlertTriangle,
  Ban,
  Check,
  Copy,
  Cpu,
  FileText,
  FolderOpen,
  Plug,
  RefreshCw,
  Repeat,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { localizeError } from '@/shared/localizeError';
import type { ConnectionMonitorEvent } from '@/shared/ipc';
import { useAppSnapshotContext } from '@/renderer/hooks/useAppSnapshot';
import { useSettingsMonitor } from '@/renderer/hooks/useSettingsMonitor';
import { useDiagnosticsActions } from '@/renderer/hooks/useDiagnosticsActions';
import { useConflictingApps } from '@/renderer/hooks/useConflictingApps';
import { useFormat } from '@/renderer/hooks/useFormat';
import { useNow } from '@/renderer/hooks/useNow';
import { ConflictingAppsPanel } from '@/renderer/components/ConflictingAppsPanel';
import {
  Button,
  ErrorText,
  Foot,
  Page,
  Panel,
  Row,
  RowGroup,
  StatusPill,
  Tile,
  Toggle,
  type Tone,
} from '@/renderer/components/ui';

const XRAY_TONES: Record<string, Tone> = {
  running: 'ok',
  starting: 'info',
  stopping: 'plain',
  stopped: 'plain',
  degraded: 'warn',
  failed: 'bad',
};

const HEALTH_TONES: Record<string, Tone> = {
  healthy: 'ok',
  idle: 'plain',
  degraded: 'warn',
  failed: 'bad',
};

const EVENT_LOOKS: Record<
  ConnectionMonitorEvent['type'],
  { icon: LucideIcon; tone: Tone }
> = {
  connected: { icon: Check, tone: 'ok' },
  disconnected: { icon: XCircle, tone: 'plain' },
  error: { icon: AlertTriangle, tone: 'warn' },
  blocked: { icon: Ban, tone: 'warn' },
  switching: { icon: Repeat, tone: 'info' },
};

/** «Диагностика»: core state, connection monitoring, events and logs. */
export const DiagnosticsPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const format = useFormat();
  const { snapshot } = useAppSnapshotContext();
  const { recentEvents } = useSettingsMonitor({ isOpen: true });
  const {
    copied,
    copyError,
    toggleAutoSwitching,
    clearBlocked,
    copyLogs,
    openLogFolder,
  } = useDiagnosticsActions();
  const conflicts = useConflictingApps();
  const { runScan: scanConflicts } = conflicts;
  const { session, health, process, recovery, autoSwitchingEnabled, servers } =
    snapshot;
  const localize = (message: string) => localizeError(message, i18n.language);
  const now = useNow(5_000);

  // One `tasklist` per visit: cheap, and the answer is what this page is for
  // when TUN misbehaves. Non-Windows hosts report `supported: false`.
  useEffect(() => {
    void scanConflicts();
  }, [scanConflicts]);

  const blockedNames = session.blockedServerIds.map(
    (serverId) =>
      servers.find((server) => server.uuid === serverId)?.name ??
      t('settings.diagnostics.serverShort', { id: serverId.substring(0, 8) }),
  );

  const recoveryState = recovery.recoveryInProgress
    ? { text: t('pages.diag.recoveryRunning'), tone: 'info' as Tone }
    : recovery.recoveryBlocked
      ? { text: t('pages.diag.recoveryPaused'), tone: 'warn' as Tone }
      : { text: t('pages.diag.recoveryIdle'), tone: 'plain' as Tone };

  const failures = [
    session.lastError &&
      `${t('settings.diagnostics.lastError')}: ${localize(session.lastError)}`,
    health.lastHealthFailureReason &&
      `${t('settings.diagnostics.healthFailure')}: ${localize(health.lastHealthFailureReason)}`,
    process.lastFailureReason &&
      `${t('settings.diagnostics.xrayFailure')}: ${localize(process.lastFailureReason)}`,
    recovery.lastFatalReason &&
      `${t('settings.diagnostics.lastFatal')}: ${localize(recovery.lastFatalReason)}`,
  ].filter((line): line is string => !!line);

  return (
    <Page title={t('pages.diag.title')} lead={t('pages.diag.lead')}>
      <Panel title={t('pages.diag.state')}>
        <RowGroup>
          <Row
            tile={<Tile icon={Cpu} />}
            label={t('settings.diagnostics.xrayState')}
            hint={
              process.lastStartAt && process.xrayRunning
                ? t('pages.diag.startedAt', {
                    time: format.clock(process.lastStartAt),
                  })
                : undefined
            }
            trailing={
              <StatusPill tone={XRAY_TONES[process.state] ?? 'plain'}>
                {t(`pages.diag.xray.${process.state}`)}
              </StatusPill>
            }
          />
          <Row
            tile={<Tile icon={Activity} />}
            label={t('settings.diagnostics.lastHealthCheck')}
            hint={
              health.lastHealthCheckAt
                ? t('pages.diag.checkedAgo', {
                    ago: format.ago(now - health.lastHealthCheckAt),
                  })
                : t('pages.diag.notChecked')
            }
            trailing={
              <StatusPill
                tone={HEALTH_TONES[health.lastHealthState] ?? 'plain'}
              >
                {t(`pages.diag.health.${health.lastHealthState}`)}
              </StatusPill>
            }
          />
          <Row
            tile={<Tile icon={Plug} />}
            label={t('pages.diag.localProxy')}
            hint="127.0.0.1"
            trailing={
              <StatusPill
                tone={
                  health.localProxyReachable == null
                    ? 'plain'
                    : health.localProxyReachable
                      ? 'ok'
                      : 'warn'
                }
              >
                {health.localProxyReachable == null
                  ? t('pages.diag.proxyUnknown')
                  : health.localProxyReachable
                    ? t('pages.diag.proxyReachable')
                    : t('pages.diag.proxyUnreachable')}
              </StatusPill>
            }
          />
          <Row
            tile={<Tile icon={RefreshCw} />}
            label={t('pages.diag.recovery')}
            hint={[
              t('pages.diag.attempts', {
                count: recovery.recoveryAttemptCount,
              }),
              recovery.lastRecoveryAt
                ? `${t('settings.diagnostics.lastRecovery')}: ${format.clock(recovery.lastRecoveryAt)}`
                : null,
            ]
              .filter(Boolean)
              .join(' · ')}
            trailing={
              <StatusPill tone={recoveryState.tone}>
                {recoveryState.text}
              </StatusPill>
            }
          />
        </RowGroup>
        {failures.map((line) => (
          <ErrorText key={line}>{line}</ErrorText>
        ))}
      </Panel>

      <Panel title={t('settings.diagnostics.monitoring')}>
        <RowGroup>
          <Row
            label={t('settings.diagnostics.autoSwitching')}
            hint={t('settings.diagnostics.autoSwitchingDesc')}
            trailing={
              <Toggle
                checked={autoSwitchingEnabled}
                onChange={(enabled) => void toggleAutoSwitching(enabled)}
                ariaLabel={t('settings.diagnostics.autoSwitching')}
              />
            }
          />
          {blockedNames.length > 0 && (
            <Row
              label={t('pages.diag.blocked', { count: blockedNames.length })}
              hint={t('pages.diag.blockedHint', {
                names: blockedNames.join(', '),
              })}
              trailing={
                <Button size="sm" onClick={() => void clearBlocked()}>
                  {t('settings.diagnostics.clear')}
                </Button>
              }
            />
          )}
        </RowGroup>
      </Panel>

      <Panel title={t('settings.diagnostics.recentEvents')}>
        {recentEvents.length > 0 ? (
          <RowGroup>
            {recentEvents.map((event, index) => {
              const look = EVENT_LOOKS[event.type];
              const title =
                (event.message && localize(event.message)) ||
                t(`settings.diagnostics.eventTypes.${event.type}`, {
                  defaultValue: event.type,
                });
              return (
                <Row
                  key={index}
                  tile={<Tile icon={look.icon} tone={look.tone} />}
                  label={title}
                  hint={event.server?.name}
                />
              );
            })}
          </RowGroup>
        ) : (
          <Foot>{t('pages.diag.noEvents')}</Foot>
        )}
      </Panel>

      {conflicts.scan?.supported && (
        <Panel title={t('settings.diagnostics.conflicts')}>
          <ConflictingAppsPanel
            scan={conflicts.scan}
            scanning={conflicts.scanning}
            error={conflicts.error}
            closingIds={conflicts.closingIds}
            failedIds={conflicts.failedIds}
            onCloseApp={(appId) => void conflicts.closeApp(appId)}
            onRescan={() => void scanConflicts()}
            showEmptyState
          />
        </Panel>
      )}

      <Panel
        title={t('settings.diagnostics.troubleshooting')}
        foot={<Foot>{t('settings.diagnostics.sanitizedHint')}</Foot>}
      >
        <RowGroup>
          <Row
            tile={<Tile icon={FileText} />}
            label={t('pages.diag.logs')}
            hint={t('pages.diag.logsHint')}
            trailing={
              <span className="flex shrink-0 gap-2">
                <Button
                  size="sm"
                  icon={copied ? Check : Copy}
                  onClick={() => void copyLogs()}
                >
                  {copied
                    ? t('settings.diagnostics.copied')
                    : t('settings.diagnostics.copyLogs')}
                </Button>
                <Button size="sm" icon={FolderOpen} onClick={openLogFolder}>
                  {t('settings.diagnostics.openFolder')}
                </Button>
              </span>
            }
          />
        </RowGroup>
        {copyError && <ErrorText>{copyError}</ErrorText>}
      </Panel>
    </Page>
  );
};
