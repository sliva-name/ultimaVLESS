import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Activity,
  Lock,
  PauseCircle,
  RefreshCw,
  Server,
  Square,
  Trash2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Subscription, VlessConfig } from '@/shared/types';
import type { SessionPhase } from '@/shared/ipc';
import { localizeError } from '@/shared/localizeError';
import { buildSidebarServerBuckets } from '@/renderer/components/sidebarModel';
import { useRenderPerf } from '@/renderer/hooks/useRenderPerf';
import { useFormat } from '@/renderer/hooks/useFormat';
import { useNow } from '@/renderer/hooks/useNow';
import {
  ErrorText,
  IconButton,
  MenuSeparator,
  type MenuEntry,
} from '@/renderer/components/ui';
import { ServerGroup } from './ServerGroup';
import type { RowContext, ServerRowData } from './ServerRow';
import { describeServer } from './serverParts';

interface ServerPanelProps {
  servers: VlessConfig[];
  subscriptions: Subscription[];
  selectedServer: VlessConfig | null;
  phase: SessionPhase;
  blockedServerIds: string[];
  /** True while connected or in-flight — idle and failed sessions can still pick a server. */
  selectionLocked: boolean;
  isRefreshingPings: boolean;
  onSelectServer: (server: VlessConfig) => void;
  onPingAll: () => Promise<void>;
  onPingServers: (serverIds: string[]) => Promise<void>;
  onStopPing: () => Promise<void>;
  onDisconnect: () => void;
  onRefreshSubscriptions: () => Promise<void>;
  refreshError: string | null;
  onToggleSubscription: (subscription: Subscription) => void;
  onDeleteSubscription: (id: string) => void;
}

interface Group {
  id: string;
  title: string;
  servers: VlessConfig[];
  subscription?: Subscription;
}

/** A check the user started here: which rows still wait for an answer. */
interface PingPass {
  startedAt: number;
  ids: ReadonlySet<string> | null;
}

/**
 * The server list: every source as a group, rows sorted by latency, no
 * search or filters. While a session runs the list is read-only, as before.
 */
export const ServerPanel: React.FC<ServerPanelProps> = ({
  servers,
  subscriptions,
  selectedServer,
  phase,
  blockedServerIds,
  selectionLocked,
  isRefreshingPings,
  onSelectServer,
  onPingAll,
  onPingServers,
  onStopPing,
  onDisconnect,
  onRefreshSubscriptions,
  refreshError,
  onToggleSubscription,
  onDeleteSubscription,
}) => {
  const { t, i18n } = useTranslation();
  const format = useFormat();
  const [pass, setPass] = useState<PingPass | null>(null);
  // "Measured 40 min ago" moves on while the window is open.
  const now = useNow(30_000);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastScrolledUuidRef = useRef<string | null>(null);

  useRenderPerf('ServerPanel', [servers.length, subscriptions.length]);

  const groups = useMemo<Group[]>(() => {
    const { subscriptionGroups, orphanSubscriptionServers, manualServers } =
      buildSidebarServerBuckets(subscriptions, servers);
    return [
      ...subscriptionGroups.map(({ subscription, servers: rows }) => ({
        id: subscription.id,
        title: subscription.name,
        servers: rows,
        subscription,
      })),
      {
        id: 'orphan',
        title: t('sidebar.subscriptionShort'),
        servers: orphanSubscriptionServers,
      },
      {
        id: 'manual',
        title: t('servers.manualGroup'),
        servers: manualServers,
      },
    ].filter((group) => group.servers.length > 0);
  }, [servers, subscriptions, t]);

  useEffect(() => {
    if (!selectedServer) return;
    // Re-scroll whenever the selected server actually changes, so a pick made
    // elsewhere (tray, auto switching) stays in view.
    if (lastScrolledUuidRef.current === selectedServer.uuid) return;
    const container = scrollRef.current;
    const el = container?.querySelector(
      `[data-server-uuid="${selectedServer.uuid}"]`,
    );
    // Virtualized groups scroll to the selected row on their own.
    if (!el || el.closest('[data-testid="virtualized-server-list"]')) return;
    lastScrolledUuidRef.current = selectedServer.uuid;
    if (typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedServer, servers]);

  const pingInProgress = pass !== null || isRefreshingPings;
  const connected = phase === 'connected';

  const runPing = useCallback(
    async (ids: string[] | null) => {
      if (pingInProgress || selectionLocked) return;
      setPass({ startedAt: Date.now(), ids: ids ? new Set(ids) : null });
      try {
        await (ids ? onPingServers(ids) : onPingAll());
      } finally {
        setPass(null);
      }
    },
    [onPingAll, onPingServers, pingInProgress, selectionLocked],
  );

  const isPending = useCallback(
    (server: VlessConfig) =>
      pass !== null &&
      (pass.ids === null || pass.ids.has(server.uuid)) &&
      !(server.pingTime && server.pingTime >= pass.startedAt),
    [pass],
  );

  const blocked = useMemo(() => new Set(blockedServerIds), [blockedServerIds]);

  const rowContext = useCallback(
    (server: ServerRowData): RowContext => {
      if (connected && selectedServer?.uuid === server.uuid) {
        return { text: t('sidebar.connected'), tone: 'ok' };
      }
      if (server.outboundCompatible === false) {
        return { text: t('servers.noTls'), tone: 'warn' };
      }
      if (blocked.has(server.uuid)) {
        return { text: t('servers.blocked'), tone: 'bad' };
      }
      if (server.pingStale && server.pingTime) {
        return {
          text: t('servers.measuredAgo', {
            ago: format.ago(now - server.pingTime),
          }),
          tone: 'fg3',
        };
      }
      if (server.ping === null && server.pingTime !== undefined) {
        return { text: t('servers.noAnswer'), tone: 'fg3' };
      }
      return { text: describeServer(server), tone: 'fg3' };
    },
    [blocked, connected, format, now, selectedServer, t],
  );

  const groupMenu = (group: Group): MenuEntry[] => {
    const pingGroup = {
      label: t('servers.pingGroup'),
      icon: Activity,
      disabled: pingInProgress || selectionLocked,
      onSelect: () => void runPing(group.servers.map((server) => server.uuid)),
    };
    const subscription = group.subscription;
    if (!subscription) return [pingGroup];
    return [
      {
        label: t('servers.refreshAll'),
        icon: RefreshCw,
        onSelect: () => void onRefreshSubscriptions(),
      },
      pingGroup,
      {
        label: t('servers.disableSubscription'),
        icon: PauseCircle,
        onSelect: () => onToggleSubscription(subscription),
      },
      MenuSeparator,
      {
        label: t('servers.deleteSubscription'),
        icon: Trash2,
        danger: true,
        onSelect: () => onDeleteSubscription(subscription.id),
        confirm: {
          title: t('servers.deleteTitle', { name: subscription.name }),
          body: t('servers.deleteBody', {
            servers: t('count.servers', { count: group.servers.length }),
          }),
          action: t('servers.delete'),
        },
      },
    ];
  };

  // ↑ ↓ walk the rows; Enter and Space are the buttons' own.
  const onListKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const rows = Array.from(
      scrollRef.current?.querySelectorAll<HTMLElement>('[data-server-row]') ??
        [],
    );
    const index = rows.indexOf(document.activeElement as HTMLElement);
    if (index < 0) return;
    event.preventDefault();
    const next = rows[event.key === 'ArrowDown' ? index + 1 : index - 1];
    next?.focus();
  };

  return (
    <aside
      aria-label={t('sidebar.servers')}
      className="flex-[1_1_336px] min-w-0 flex flex-col bg-s1 border-r border-line"
    >
      <div className="h-12 shrink-0 box-border flex items-center gap-1 pl-4 pr-2">
        <h2 className="m-0 text-sm leading-5 font-semibold">
          {t('sidebar.servers')}
        </h2>
        <span className="ml-1 min-w-5 h-[18px] box-border px-1.5 rounded-[9px] bg-s3 text-[11px] leading-[18px] font-semibold text-fg2 text-center tabular-nums">
          {servers.length}
        </span>
        <span className="flex-1" />
        {servers.length > 0 &&
          (pingInProgress ? (
            <IconButton
              icon={Square}
              label={t('servers.pingStop')}
              onClick={() => void onStopPing()}
            />
          ) : (
            <IconButton
              icon={Activity}
              label={t('servers.pingAll')}
              disabled={selectionLocked}
              onClick={() => void runPing(null)}
            />
          ))}
      </div>

      {(selectionLocked || refreshError) && (
        <div className="shrink-0 px-3 flex flex-col gap-2">
          {selectionLocked && (
            <div
              role="status"
              className="flex items-center gap-2 py-1.5 pr-1.5 pl-2.5 rounded-lg bg-s2 border border-line"
            >
              <Lock
                aria-hidden
                strokeWidth={2}
                className="w-3.5 h-3.5 shrink-0 text-fg3"
              />
              <span className="flex-1 min-w-0 text-xs leading-4 text-fg2">
                {t(
                  connected ? 'servers.lockedConnected' : 'servers.lockedBusy',
                )}
              </span>
              {connected && (
                <button
                  type="button"
                  onClick={onDisconnect}
                  className="shrink-0 h-6 px-2 rounded-md text-acc text-xs leading-4 font-medium hover:bg-s3"
                >
                  {t('shell.disconnect')}
                </button>
              )}
            </div>
          )}
          {refreshError && (
            <ErrorText>{localizeError(refreshError, i18n.language)}</ErrorText>
          )}
        </div>
      )}

      {servers.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 px-8 py-6 text-center">
          <span className="w-10 h-10 rounded-[10px] bg-tile flex items-center justify-center text-fg2">
            <Server aria-hidden strokeWidth={1.75} className="w-5 h-5" />
          </span>
          <div className="flex flex-col gap-1">
            <span className="text-[13px] leading-5 font-semibold">
              {t('servers.emptyTitle')}
            </span>
            <span className="text-xs leading-4 text-fg3">
              {t('servers.emptyBody')}
            </span>
          </div>
        </div>
      ) : (
        <div
          ref={scrollRef}
          onKeyDown={onListKeyDown}
          className="flex-1 min-h-0 overflow-y-auto px-2 pb-3 pt-3 flex flex-col gap-3"
        >
          {groups.map((group) => (
            <ServerGroup
              key={group.id}
              title={group.title}
              servers={group.servers}
              selectedServer={selectedServer}
              selectionLocked={selectionLocked}
              onSelectServer={onSelectServer}
              rowContext={rowContext}
              isPending={isPending}
              menu={groupMenu(group)}
            />
          ))}
        </div>
      )}
    </aside>
  );
};
