import React, { useCallback, useMemo, useState } from 'react';
import clsx from 'clsx';
import {
  Activity,
  Loader2,
  Power,
  RefreshCw,
  Server,
  Square,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Subscription, VlessConfig } from '@/shared/types';
import { isSessionPhaseInFlight, type SessionPhase } from '@/shared/ipc';
import { CountryFlag } from '@/renderer/components/CountryFlag';
import { ServerGroup } from '@/renderer/components/sidebar/ServerGroup';
import {
  MANUAL_GROUP_COLOR,
  ORPHAN_GROUP_COLOR,
  buildSidebarServerBuckets,
  getSubscriptionColor,
} from '@/renderer/components/sidebarModel';

interface ServersScreenProps {
  servers: VlessConfig[];
  subscriptions: Subscription[];
  selectedServer: VlessConfig | null;
  phase: SessionPhase;
  selectionLocked: boolean;
  isRefreshingPings: boolean;
  onSelectServer: (server: VlessConfig) => void;
  onToggleConnection: () => void;
  onPingAll: () => Promise<void>;
  onPingSelected: () => Promise<void>;
  onStopPing: () => Promise<void>;
}

const iconButtonClass = (disabled: boolean) =>
  clsx(
    'p-2.5 rounded-xl border transition-colors',
    disabled
      ? 'text-gray-600 border-transparent'
      : 'text-gray-300 border-gray-700/50 active:bg-white/10',
  );

/**
 * The desktop sidebar's server groups as a full screen, with the connection
 * button at hand at the bottom. While a session runs, picks and pings are
 * locked, as on desktop.
 */
export const ServersScreen: React.FC<ServersScreenProps> = ({
  servers,
  subscriptions,
  selectedServer,
  phase,
  selectionLocked,
  isRefreshingPings,
  onSelectServer,
  onToggleConnection,
  onPingAll,
  onPingSelected,
  onStopPing,
}) => {
  const { t } = useTranslation();
  const [isPinging, setIsPinging] = useState(false);
  const { subscriptionGroups, orphanSubscriptionServers, manualServers } =
    useMemo(
      () => buildSidebarServerBuckets(subscriptions, servers),
      [subscriptions, servers],
    );

  const pingInProgress = isPinging || isRefreshingPings;
  const pingLocked = selectionLocked;
  const runPing = useCallback(
    async (action: () => Promise<void>) => {
      if (pingInProgress || pingLocked) return;
      setIsPinging(true);
      try {
        await action();
      } finally {
        setIsPinging(false);
      }
    },
    [pingInProgress, pingLocked],
  );

  const connected = phase === 'connected';
  const inFlight = isSessionPhaseInFlight(phase);

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <header className="mobile-top-bar shrink-0 flex items-center justify-between gap-3 px-4 pb-3 border-b border-gray-800/50">
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-200">
          <Server className="w-4 h-4 text-primary" />
          {t('sidebar.servers')} ({servers.length})
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void runPing(onPingSelected)}
            disabled={!selectedServer || pingInProgress || pingLocked}
            aria-label={t('sidebar.pingSelected')}
            className={iconButtonClass(
              !selectedServer || pingInProgress || pingLocked,
            )}
          >
            <Activity className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() =>
              pingInProgress ? void onStopPing() : void runPing(onPingAll)
            }
            disabled={!pingInProgress && (pingLocked || servers.length === 0)}
            aria-label={t(
              pingInProgress ? 'sidebar.pingStop' : 'sidebar.pingAll',
            )}
            className={iconButtonClass(
              !pingInProgress && (pingLocked || servers.length === 0),
            )}
          >
            {pingInProgress ? (
              <Square className="w-4 h-4" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
          </button>
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-3 space-y-2">
        {subscriptionGroups.map(({ subscription, servers: groupServers }) => (
          <ServerGroup
            key={subscription.id}
            title={subscription.name}
            color={getSubscriptionColor(subscription.id)}
            servers={groupServers}
            selectedServer={selectedServer}
            selectionLocked={selectionLocked}
            onSelectServer={onSelectServer}
          />
        ))}
        {orphanSubscriptionServers.length > 0 && (
          <ServerGroup
            title={t('sidebar.subscriptionShort')}
            color={ORPHAN_GROUP_COLOR}
            servers={orphanSubscriptionServers}
            selectedServer={selectedServer}
            selectionLocked={selectionLocked}
            onSelectServer={onSelectServer}
            collapsible={false}
          />
        )}
        {manualServers.length > 0 && (
          <ServerGroup
            title={t('sidebar.manualShort')}
            color={MANUAL_GROUP_COLOR}
            servers={manualServers}
            selectedServer={selectedServer}
            selectionLocked={selectionLocked}
            onSelectServer={onSelectServer}
          />
        )}
        {servers.length === 0 && (
          <div className="flex flex-col items-center justify-center p-8 text-center">
            <div className="p-4 rounded-xl bg-gray-800/30 border border-gray-700/30 mb-4">
              <Server className="w-8 h-8 text-gray-500" />
            </div>
            <p className="text-gray-400 text-sm font-medium">
              {t('sidebar.noServers')}
            </p>
          </div>
        )}
      </div>

      {selectedServer && (
        <div className="shrink-0 mx-3 mb-3 flex items-center gap-3 rounded-2xl border border-gray-700/50 bg-surface/95 px-3 py-2.5 shadow-2xl shadow-black/40">
          <CountryFlag
            server={selectedServer}
            size={24}
            className="rounded-sm shrink-0"
          />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-white truncate">
              {selectedServer.name}
            </div>
            <div
              className={clsx(
                'text-xs truncate',
                connected ? 'text-green-400' : 'text-gray-500',
              )}
            >
              {connected
                ? t('sidebar.connected')
                : inFlight
                  ? t('status.connecting')
                  : t('mobile.idle')}
            </div>
          </div>
          <button
            type="button"
            onClick={onToggleConnection}
            disabled={inFlight && phase === 'disconnecting'}
            aria-label={
              connected ? t('mobile.disconnect') : t('mobile.connect')
            }
            className={clsx(
              'w-12 h-12 shrink-0 rounded-full border-2 flex items-center justify-center transition-colors',
              connected
                ? 'border-green-500 bg-green-500/15 text-green-400'
                : 'border-gray-600 bg-gray-800/60 text-gray-300 active:bg-gray-700',
            )}
          >
            {inFlight ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Power className="w-5 h-5" />
            )}
          </button>
        </div>
      )}
    </div>
  );
};
