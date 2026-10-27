import React, { useCallback } from 'react';
import type { VlessConfig } from '@/shared/types';
import {
  AppSnapshotProvider,
  useServers,
  useSession,
} from '@/renderer/hooks/useAppSnapshot';
import { BottomNav } from './BottomNav';
import { HomeScreen } from './HomeScreen';
import { ServersScreen } from './ServersScreen';
import { SettingsScreen } from './SettingsScreen';
import { useTabHistory } from './useTabHistory';

function MobileShell() {
  const [tab, setTab] = useTabHistory();
  const {
    servers,
    subscriptions,
    selectedServer,
    isRefreshingPings,
    selectServer,
    pingAllServers,
    pingSelectedServer,
    stopPing,
  } = useServers();
  const {
    session,
    connectionMode,
    isConnected,
    isConnectionBusy,
    connectionError,
    trafficSnapshot,
    toggleConnection,
  } = useSession();

  const handleToggleConnection = useCallback(() => {
    void toggleConnection();
  }, [toggleConnection]);
  const handleSelectServer = useCallback(
    (server: VlessConfig) => selectServer(server),
    [selectServer],
  );

  return (
    <div className="mobile-shell flex flex-col h-full min-h-0 bg-linear-to-br from-background via-background to-gray-950 text-gray-200 relative overflow-hidden">
      <div className="absolute inset-0 app-ambient-glow pointer-events-none" />
      <main className="relative flex-1 min-h-0 flex flex-col">
        {tab === 'home' && (
          <HomeScreen
            phase={session.phase}
            connectionMode={connectionMode}
            isConnectionBusy={isConnectionBusy}
            selectedServer={selectedServer}
            connectionError={connectionError}
            trafficSnapshot={trafficSnapshot}
            onToggleConnection={handleToggleConnection}
            onChooseServer={() => setTab('servers')}
          />
        )}
        {tab === 'servers' && (
          <ServersScreen
            servers={servers}
            subscriptions={subscriptions}
            selectedServer={selectedServer}
            phase={session.phase}
            // As on desktop: disconnect before picking another server. Failed
            // sessions stay selectable so a bad profile does not freeze the list.
            selectionLocked={isConnectionBusy || isConnected}
            isRefreshingPings={isRefreshingPings}
            onSelectServer={handleSelectServer}
            onToggleConnection={handleToggleConnection}
            onPingAll={pingAllServers}
            onPingSelected={pingSelectedServer}
            onStopPing={stopPing}
          />
        )}
        {tab === 'settings' && (
          <SettingsScreen
            servers={servers}
            subscriptions={subscriptions}
            isConnected={isConnected}
            isConnectionBusy={isConnectionBusy}
          />
        )}
      </main>
      <BottomNav tab={tab} isConnected={isConnected} onChange={setTab} />
    </div>
  );
}

export function MobileApp() {
  return (
    <AppSnapshotProvider>
      <MobileShell />
    </AppSnapshotProvider>
  );
}
