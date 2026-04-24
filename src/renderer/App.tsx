import React, { useState, useCallback } from 'react';
import { Sidebar } from './components/Sidebar';
import { SettingsModal } from './components/SettingsModal';
import { ConnectionStatus } from './components/ConnectionStatus';
import { UpdateBanner } from './components/UpdateBanner';
import { useServerState } from './hooks/useServerState';

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
    trafficSnapshot,
    setSelectedServer,
    toggleConnection,
    pingAllServers,
  } = useServerState();

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const handleOpenSettings = useCallback(() => setIsSettingsOpen(true), []);
  const handleCloseSettings = useCallback(() => setIsSettingsOpen(false), []);

  return (
    <div className="flex flex-col md:flex-row h-screen min-h-0 bg-linear-to-br from-background via-background to-gray-950 text-gray-200 relative overflow-hidden">
      <div className="absolute inset-0 bg-linear-to-br from-primary/3 via-transparent to-transparent pointer-events-none" />
      <div className="absolute top-0 right-0 w-1/2 h-1/2 bg-primary/2 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-1/2 h-1/2 bg-blue-500/2 rounded-full blur-3xl pointer-events-none" />

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
          className="h-8 w-full app-drag-region bg-linear-to-r from-surface/50 to-transparent backdrop-blur-sm border-b border-gray-800/30"
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
