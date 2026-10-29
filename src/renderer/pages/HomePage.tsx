import React from 'react';
import type { ConnectionMode } from '@/shared/types';
import {
  useAppSnapshot,
  useServers,
  useSession,
} from '@/renderer/hooks/useAppSnapshot';
import { useSourcesSettings } from '@/renderer/hooks/useSourcesSettings';
import { useRefreshSubscriptions } from '@/renderer/hooks/useRefreshSubscriptions';
import { ServerPanel } from '@/renderer/components/servers/ServerPanel';
import { Stage } from '@/renderer/components/home/Stage';
import { EmptyStage } from '@/renderer/components/home/EmptyStage';
import { TunConflictNotice } from '@/renderer/components/TunConflictNotice';
import type { Section } from '@/renderer/components/shell/Rail';

interface HomePageProps {
  onNavigate: (section: Section) => void;
  onModeChange: (mode: ConnectionMode) => void;
}

/** Server list on the left, the connection ring on the stage. */
export const HomePage: React.FC<HomePageProps> = ({
  onNavigate,
  onModeChange,
}) => {
  const snapshot = useAppSnapshot();
  const {
    servers,
    subscriptions,
    selectedServer,
    isRefreshingPings,
    selectServer,
    pingAllServers,
    pingServers,
    stopPing,
  } = useServers();
  const {
    session,
    connectionMode,
    tunConflicts,
    isConnected,
    isConnectionBusy,
    connectionError,
    toggleConnection,
  } = useSession();
  const sources = useSourcesSettings(false);
  const { refreshAll, refreshError } = useRefreshSubscriptions();

  return (
    <div className="flex-1 min-w-0 min-h-0 flex">
      <ServerPanel
        servers={servers}
        subscriptions={subscriptions}
        selectedServer={selectedServer}
        phase={session.phase}
        blockedServerIds={session.blockedServerIds}
        // Failed sessions stay selectable so a bad profile does not freeze the list.
        selectionLocked={isConnectionBusy || isConnected}
        isRefreshingPings={isRefreshingPings}
        onSelectServer={selectServer}
        onPingAll={pingAllServers}
        onPingServers={pingServers}
        onStopPing={stopPing}
        onDisconnect={() => void toggleConnection()}
        onRefreshSubscriptions={refreshAll}
        refreshError={refreshError}
        onToggleSubscription={(subscription) =>
          void sources.toggleSubscription(subscription)
        }
        onDeleteSubscription={(id) => void sources.deleteSubscription(id)}
      />

      <main className="flex-[999_1_400px] min-w-0 min-h-0 overflow-y-auto flex flex-col bg-canvas">
        <div className="shrink-0 px-8 pt-4 empty:hidden">
          <TunConflictNotice
            check={tunConflicts}
            connectionMode={connectionMode}
          />
        </div>
        {servers.length === 0 ? (
          <EmptyStage onOpenSources={() => onNavigate('subs')} />
        ) : (
          <Stage
            snapshot={snapshot}
            selectedServer={selectedServer}
            connectionError={connectionError}
            isConnectionBusy={isConnectionBusy}
            onToggleConnection={() => void toggleConnection()}
            onModeChange={onModeChange}
            onOpenRouting={() => onNavigate('routing')}
            onOpenDiagnostics={() => onNavigate('diag')}
          />
        )}
      </main>
    </div>
  );
};
