import React, { useState, useCallback } from 'react';
import { Sidebar } from './components/Sidebar';
import { SettingsModal } from './components/SettingsModal';
import { ConnectionStatus } from './components/ConnectionStatus';
import { UpdateBanner } from './components/UpdateBanner';
import {
  AppSnapshotProvider,
  useServers,
  useSession,
} from './hooks/useAppSnapshot';

type DragRegionStyle = React.CSSProperties & {
  WebkitAppRegion: 'drag' | 'no-drag';
};
const dragRegionStyle: DragRegionStyle = { WebkitAppRegion: 'drag' };

function AppShell() {
  const {
    servers,
    subscriptions,
    selectedServer,
    isRefreshingPings,
    selectServer,
    pingAllServers,
  } = useServers();
  const {
    session,
    isConnected,
    isConnectionBusy,
    connectionError,
    trafficSnapshot,
    toggleConnection,
  } = useSession();
  const isSwitching = session.status === 'switching';

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const handleOpenSettings = useCallback(() => setIsSettingsOpen(true), []);
  const handleCloseSettings = useCallback(() => setIsSettingsOpen(false), []);

  return (
    <div className="flex flex-col md:flex-row h-screen min-h-0 bg-linear-to-br from-background via-background to-gray-950 text-gray-200 relative overflow-hidden">
      <div className="absolute inset-0 app-ambient-glow pointer-events-none" />

      <Sidebar
        servers={servers}
        subscriptions={subscriptions}
        selectedServer={selectedServer}
        isConnected={isConnected}
        isRefreshingPings={isRefreshingPings}
        onSelectServer={selectServer}
        onOpenSettings={handleOpenSettings}
        onPingAll={pingAllServers}
      />

      <div className="flex-1 flex flex-col min-h-0 min-w-0 relative">
        <div
          className="h-8 w-full app-drag-region bg-linear-to-r from-surface/70 to-transparent border-b border-gray-800/30"
          style={dragRegionStyle}
        />

        <div className={isSettingsOpen ? 'hidden' : 'contents'}>
          <UpdateBanner />
          <ConnectionStatus
            isConnected={isConnected}
            isSwitching={isSwitching}
            isBusy={isConnectionBusy}
            selectedServer={selectedServer}
            connectionError={connectionError}
            trafficSnapshot={trafficSnapshot}
            onToggleConnection={toggleConnection}
          />
        </div>

        <SettingsModal
          isOpen={isSettingsOpen}
          servers={servers}
          subscriptions={subscriptions}
          isConnected={isConnected}
          isConnectionBusy={isConnectionBusy}
          onClose={handleCloseSettings}
        />
      </div>
    </div>
  );
}

function App() {
  return (
    <AppSnapshotProvider>
      <AppShell />
    </AppSnapshotProvider>
  );
}

export default App;
