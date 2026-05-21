import React, { useCallback, useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { SettingsModal } from './components/SettingsModal';
import { ConnectionStatus } from './components/ConnectionStatus';
import { UpdateBanner } from './components/UpdateBanner';
import { useServerState } from './hooks/useServerState';
import { useTrafficStats } from './hooks/useTrafficStats';

type DragRegionStyle = React.CSSProperties & {
  WebkitAppRegion: 'drag' | 'no-drag';
};
const dragRegionStyle: DragRegionStyle = { WebkitAppRegion: 'drag' };

function App() {
  const {
    servers,
    subscriptions,
    selectedServer,
    isConnected,
    isConnectionBusy,
    connectionError,
    setSelectedServer,
    toggleConnection,
    pingAllServers,
  } = useServerState();
  const trafficSnapshot = useTrafficStats();

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
        onSelectServer={setSelectedServer}
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

export default App;
