import React, { useCallback, useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import {
  ChevronDown,
  Loader2,
  Lock,
  Power,
  RefreshCw,
  Server,
  Square,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ConnectionMode, Subscription, VlessConfig } from '@/shared/types';
import type { SafeServerConfig } from '@/shared/serverView';
import { isSessionPhaseInFlight, type SessionPhase } from '@/shared/ipc';
import { buildSidebarServerBuckets } from '@/renderer/components/sidebarModel';
import { useFormat } from './format';
import {
  describeServer,
  PingBadge,
  ServerFlag,
  subscriptionColorIndex,
} from './serverParts';

type ServerRow = VlessConfig & Pick<SafeServerConfig, 'outboundCompatible'>;

interface ServersScreenProps {
  servers: VlessConfig[];
  subscriptions: Subscription[];
  selectedServer: VlessConfig | null;
  phase: SessionPhase;
  connectionMode: ConnectionMode;
  selectionLocked: boolean;
  isRefreshingPings: boolean;
  onSelectServer: (server: VlessConfig) => void;
  onToggleConnection: () => void;
  onPingAll: () => Promise<void>;
  onStopPing: () => Promise<void>;
}

/** Group dots, in the order of the desktop subscription colors. */
const GROUP_DOTS = ['bg-acc', 'bg-ok', 'bg-warn', 'bg-bad', 'bg-teal'];

const groupDot = (subscriptionId: string) =>
  GROUP_DOTS[subscriptionColorIndex(subscriptionId)];

interface Group {
  id: string;
  title: string;
  dot: string;
  servers: ServerRow[];
}

/**
 * Servers of every source, sorted by latency. While a session runs, picks
 * and checks are locked, as on desktop.
 */
export const ServersScreen: React.FC<ServersScreenProps> = ({
  servers,
  subscriptions,
  selectedServer,
  phase,
  connectionMode,
  selectionLocked,
  isRefreshingPings,
  onSelectServer,
  onToggleConnection,
  onPingAll,
  onStopPing,
}) => {
  const { t } = useTranslation();
  const format = useFormat();
  const [isPinging, setIsPinging] = useState(false);
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  // Start of the check the user ran: rows measured after it are done. A
  // check main runs by itself has no start here and shows no per-row state.
  const [passStart, setPassStart] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const groups = useMemo<Group[]>(() => {
    const { subscriptionGroups, orphanSubscriptionServers, manualServers } =
      buildSidebarServerBuckets(subscriptions, servers);
    return [
      ...subscriptionGroups.map(({ subscription, servers: rows }) => ({
        id: subscription.id,
        title: subscription.name,
        dot: groupDot(subscription.id),
        servers: rows,
      })),
      {
        id: 'orphan',
        title: t('sidebar.subscriptionShort'),
        dot: 'bg-acc',
        servers: orphanSubscriptionServers,
      },
      {
        id: 'manual',
        title: t('mobile.servers.manualGroup'),
        dot: 'bg-violet',
        servers: manualServers,
      },
    ].filter((group) => group.servers.length > 0);
  }, [servers, subscriptions, t]);

  const pingInProgress = isPinging || isRefreshingPings;

  // "Measured 40 min ago" moves on while the screen is open.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const runPing = useCallback(async () => {
    if (pingInProgress || selectionLocked) return;
    setIsPinging(true);
    setPassStart(Date.now());
    try {
      await onPingAll();
    } finally {
      setIsPinging(false);
      setPassStart(null);
    }
  }, [onPingAll, pingInProgress, selectionLocked]);

  const isPending = (server: VlessConfig) =>
    passStart !== null && !(server.pingTime && server.pingTime >= passStart);
  const measured =
    passStart === null ? 0 : servers.filter((s) => !isPending(s)).length;
  const progress = servers.length > 0 ? measured / servers.length : 0;

  const connected = phase === 'connected';
  const inFlight = isSessionPhaseInFlight(phase);
  const checkDisabled =
    !pingInProgress && (selectionLocked || servers.length === 0);

  const rowSub = (server: ServerRow): { text: string; tone: string } => {
    if (connected && selectedServer?.uuid === server.uuid) {
      return { text: t('sidebar.connected'), tone: 'text-ok' };
    }
    if (server.outboundCompatible === false) {
      return { text: t('mobile.servers.noTls'), tone: 'text-warn' };
    }
    if (server.pingStale && server.pingTime) {
      return {
        text: t('mobile.servers.measuredAgo', {
          ago: format.ago(now - server.pingTime),
        }),
        tone: 'text-fg3',
      };
    }
    if (server.ping === null && server.pingTime !== undefined) {
      return { text: t('mobile.servers.noAnswer'), tone: 'text-fg3' };
    }
    return { text: describeServer(server), tone: 'text-fg3' };
  };

  const status = connected
    ? `${t('sidebar.connected')} · ${t(
        connectionMode === 'tun'
          ? 'settings.network.tunMode'
          : 'settings.network.proxyMode',
      )}`
    : phase === 'disconnecting'
      ? t('status.disconnecting')
      : inFlight
        ? t('status.connecting')
        : t('mobile.idle');

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <header className="h-16 shrink-0 flex items-center gap-2 pl-5 pr-3">
        <h1 className="m-0 text-[22px] leading-7 font-semibold tracking-[-0.02em]">
          {t('sidebar.servers')}
        </h1>
        <span className="min-w-6 h-[22px] px-[7px] rounded-[11px] bg-s3 text-xs leading-[22px] font-semibold text-fg2 text-center tabular-nums">
          {servers.length}
        </span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => (pingInProgress ? void onStopPing() : void runPing())}
          disabled={checkDisabled}
          className={clsx(
            'h-10 inline-flex items-center gap-2 pl-3 pr-3.5 rounded-xl border text-sm leading-4 font-medium',
            pingInProgress
              ? 'bg-s2 border-line2 text-fg'
              : checkDisabled
                ? 'border-line text-dim'
                : 'bg-acc-soft border-acc-line text-fg',
          )}
        >
          {pingInProgress ? (
            <Square aria-hidden strokeWidth={2} className="w-[18px] h-[18px]" />
          ) : (
            <RefreshCw
              aria-hidden
              strokeWidth={2}
              className="w-[18px] h-[18px]"
            />
          )}
          {t(pingInProgress ? 'mobile.servers.stop' : 'mobile.servers.check')}
        </button>
      </header>

      {pingInProgress && (
        <div
          role="progressbar"
          aria-label={t('mobile.servers.progressAria')}
          aria-valuemin={passStart === null ? undefined : 0}
          aria-valuemax={passStart === null ? undefined : servers.length}
          aria-valuenow={passStart === null ? undefined : measured}
          className="shrink-0 h-1 mx-5 mb-2 rounded-sm bg-s3 overflow-hidden"
        >
          <span
            className={clsx(
              'block h-1 rounded-sm bg-acc transition-[width] duration-300',
              passStart === null && 'w-full opacity-60 animate-pulse',
            )}
            style={
              passStart === null
                ? undefined
                : { width: `${Math.round(progress * 100)}%` }
            }
          />
        </div>
      )}

      {selectionLocked && (
        <div
          role="status"
          className="shrink-0 mx-4 mb-2 flex items-center gap-2.5 py-1 pr-1 pl-3.5 rounded-xl bg-s2 border border-line"
        >
          <Lock
            aria-hidden
            strokeWidth={2}
            className="w-4 h-4 shrink-0 text-fg3"
          />
          <span className="flex-1 min-w-0 text-[13px] leading-[18px] text-fg2">
            {t('mobile.servers.locked')}
          </span>
          <button
            type="button"
            onClick={onToggleConnection}
            disabled={phase === 'disconnecting'}
            className="h-10 px-3 rounded-[10px] text-acc text-sm leading-4 font-medium disabled:opacity-50"
          >
            {t('mobile.disconnect')}
          </button>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-2 pt-1 pb-3 flex flex-col gap-2">
        {groups.map((group) => {
          const open = !closed[group.id];
          return (
            <section
              key={group.id}
              aria-label={group.title}
              className="flex flex-col gap-0.5"
            >
              <button
                type="button"
                aria-expanded={open}
                onClick={() =>
                  setClosed((prev) => ({ ...prev, [group.id]: open }))
                }
                className="h-10 flex items-center gap-2 pl-3 pr-2 rounded-[10px] text-fg3 text-left"
              >
                <span
                  className={clsx('w-2 h-2 rounded-full shrink-0', group.dot)}
                />
                <span className="min-w-0 text-xs leading-4 font-semibold tracking-[0.06em] uppercase truncate">
                  {group.title}
                </span>
                <span className="text-xs leading-4 font-semibold tabular-nums">
                  {group.servers.length}
                </span>
                <span className="flex-1" />
                <ChevronDown
                  aria-hidden
                  strokeWidth={2}
                  className={clsx(
                    'w-5 h-5 transition-transform duration-200',
                    !open && '-rotate-90',
                  )}
                />
              </button>
              {open &&
                group.servers.map((server) => {
                  const selected = selectedServer?.uuid === server.uuid;
                  const sub = rowSub(server);
                  return (
                    <button
                      key={server.uuid}
                      type="button"
                      aria-pressed={selected}
                      aria-disabled={selectionLocked}
                      data-server-uuid={server.uuid}
                      onClick={() => {
                        if (!selectionLocked) onSelectServer(server);
                      }}
                      className={clsx(
                        'h-16 flex items-center gap-3.5 px-3 rounded-xl text-left transition-[background-color,opacity] duration-200',
                        selected
                          ? 'bg-acc-soft shadow-[inset_0_0_0_1px_var(--color-acc-line)]'
                          : 'bg-transparent',
                        selectionLocked && !selected && 'opacity-50',
                      )}
                    >
                      <ServerFlag server={server} size={28} />
                      <span className="flex-1 min-w-0 flex flex-col gap-0.5">
                        <span className="text-base leading-[22px] font-medium truncate">
                          {server.name}
                        </span>
                        <span
                          className={clsx(
                            'text-[13px] leading-[18px] truncate',
                            sub.tone,
                          )}
                        >
                          {sub.text}
                        </span>
                      </span>
                      <PingBadge server={server} pending={isPending(server)} />
                    </button>
                  );
                })}
            </section>
          );
        })}
        {servers.length === 0 && (
          <div className="flex flex-col items-center justify-center p-8 text-center gap-4">
            <span className="p-4 rounded-2xl bg-s2 border border-line">
              <Server aria-hidden className="w-8 h-8 text-fg3" />
            </span>
            <p className="m-0 text-sm text-fg2">{t('sidebar.noServers')}</p>
          </div>
        )}
      </div>

      {selectedServer && (
        <div className="shrink-0 mx-3 mb-3 h-[72px] flex items-center gap-3 pl-4 pr-3 rounded-[20px] bg-s1 border border-line2 shadow-float">
          <ServerFlag server={selectedServer} size={28} />
          <span className="flex-1 min-w-0 flex flex-col gap-0.5">
            <span className="text-base leading-[22px] font-semibold truncate">
              {selectedServer.name}
            </span>
            <span
              className={clsx(
                'text-[13px] leading-[18px] truncate',
                connected ? 'text-ok' : 'text-fg3',
              )}
            >
              {status}
            </span>
          </span>
          <button
            type="button"
            onClick={onToggleConnection}
            disabled={phase === 'disconnecting'}
            aria-label={t(
              connected || inFlight ? 'mobile.disconnect' : 'mobile.connect',
            )}
            className={clsx(
              'w-12 h-12 shrink-0 flex items-center justify-center rounded-full border-2 transition-colors duration-200',
              connected
                ? 'bg-ok-soft text-ok border-ok'
                : 'bg-acc-fill text-white border-acc-fill',
            )}
          >
            {inFlight ? (
              <Loader2
                aria-hidden
                strokeWidth={2.25}
                className="w-[22px] h-[22px] animate-spin"
              />
            ) : (
              <Power
                aria-hidden
                strokeWidth={2.25}
                className="w-[22px] h-[22px]"
              />
            )}
          </button>
        </div>
      )}
    </div>
  );
};
