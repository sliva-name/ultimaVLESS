import React, { useCallback } from 'react';
import type { VlessConfig } from '@/shared/types';
import {
  AppSnapshotProvider,
  useAppSnapshot,
  useServers,
  useSession,
} from '@/renderer/hooks/useAppSnapshot';
import { BottomNav } from './BottomNav';
import { HomeScreen } from './HomeScreen';
import { ServersScreen } from './ServersScreen';
import { SettingsScreen } from './SettingsScreen';
import {
  settingsChain,
  useMobileNav,
  type MobileRoute,
  type MobileTab,
  type SettingsPage,
} from './useMobileNav';

function MobileShell() {
  const { route, navigate, back } = useMobileNav();
  const {
    servers,
    subscriptions,
    selectedServer,
    isRefreshingPings,
    selectServer,
    pingAllServers,
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
  const { process } = useAppSnapshot();

  const handleToggleConnection = useCallback(() => {
    void toggleConnection();
  }, [toggleConnection]);
  const handleSelectServer = useCallback(
    (server: VlessConfig) => selectServer(server),
    [selectServer],
  );
  const openTab = useCallback(
    (tab: MobileTab) => navigate(tab === 'home' ? [] : [{ tab, page: 'root' }]),
    [navigate],
  );
  const openSettings = useCallback(
    (page: SettingsPage, extra?: Partial<MobileRoute>) =>
      navigate(settingsChain(page, extra)),
    [navigate],
  );

  // The app picker is a full-screen dialog over the routing screen.
  const modal = route.tab === 'settings' && route.page === 'apps';

  return (
    <div className="mobile-shell mobile-inset-top flex flex-col h-full min-h-0 bg-canvas text-fg relative overflow-hidden antialiased">
      <div className="relative flex-1 min-h-0 flex flex-col">
        {route.tab === 'home' && (
          <HomeScreen
            phase={session.phase}
            processState={process.state}
            connectionMode={connectionMode}
            isConnectionBusy={isConnectionBusy}
            selectedServer={selectedServer}
            hasServers={servers.length > 0}
            connectionError={connectionError}
            trafficSnapshot={trafficSnapshot}
            onToggleConnection={handleToggleConnection}
            onOpenServers={() => openTab('servers')}
            onOpenSettings={openSettings}
          />
        )}
        {route.tab === 'servers' && (
          <ServersScreen
            servers={servers}
            subscriptions={subscriptions}
            selectedServer={selectedServer}
            phase={session.phase}
            connectionMode={connectionMode}
            // As on desktop: disconnect before picking another server. Failed
            // sessions stay selectable so a bad profile does not freeze the list.
            selectionLocked={isConnectionBusy || isConnected}
            isRefreshingPings={isRefreshingPings}
            onSelectServer={handleSelectServer}
            onToggleConnection={handleToggleConnection}
            onPingAll={pingAllServers}
            onStopPing={stopPing}
          />
        )}
        {route.tab === 'settings' && (
          <SettingsScreen
            route={route}
            servers={servers}
            subscriptions={subscriptions}
            isConnected={isConnected}
            isConnectionBusy={isConnectionBusy}
            onToggleConnection={handleToggleConnection}
            onOpen={openSettings}
            onBack={back}
          />
        )}
      </div>
      {!modal && (
        <BottomNav
          tab={route.tab}
          isConnected={isConnected}
          onChange={openTab}
        />
      )}
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
