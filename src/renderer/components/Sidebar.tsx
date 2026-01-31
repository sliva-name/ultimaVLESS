import React, { useState, useEffect } from 'react';
import { VlessConfig } from '../../shared/types';
import { ShieldCheck, Settings, Server, RefreshCw } from 'lucide-react';
import clsx from 'clsx';
import { CountryFlag } from './CountryFlag';

interface SidebarProps {
  servers: VlessConfig[];
  selectedServer: VlessConfig | null;
  isConnected: boolean;
  onSelectServer: (server: VlessConfig) => void;
  onOpenSettings: () => void;
  onPingAll?: () => Promise<void>;
}

export const Sidebar: React.FC<SidebarProps> = ({ 
  servers, 
  selectedServer, 
  isConnected, 
  onSelectServer, 
  onOpenSettings,
  onPingAll
}) => {
  const [appVersion, setAppVersion] = useState<string>('');
  const [isPinging, setIsPinging] = useState(false);

  useEffect(() => {
    window.electronAPI.getAppVersion().then(setAppVersion).catch(() => {
      // Fallback if version cannot be retrieved
      setAppVersion('');
    });
  }, []);

  const handlePingAll = async () => {
    if (!onPingAll || isPinging) return;
    setIsPinging(true);
    try {
      await onPingAll();
    } finally {
      setIsPinging(false);
    }
  };

  return (
    <div className="w-72 bg-gradient-to-b from-surface via-surface to-surface/95 backdrop-blur-xl border-r border-gray-800/50 flex flex-col shadow-2xl shadow-black/30 relative overflow-hidden">
      {/* Decorative gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent pointer-events-none" />
      
      {/* Header */}
      <div className="relative z-10 p-5 border-b border-gray-800/50 bg-gradient-to-r from-surface to-surface/95 backdrop-blur-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-gradient-to-br from-primary/20 to-primary/10 border border-primary/30 shadow-lg shadow-primary/10">
              <ShieldCheck className="text-primary w-5 h-5" />
            </div>
            <div>
              <h1 className="font-bold text-lg text-white tracking-tight">UltimaClient</h1>
              <p className="text-xs text-gray-400 mt-0.5">VLESS VPN Client</p>
            </div>
          </div>
          <button 
            onClick={onOpenSettings} 
            className="p-2 rounded-lg hover:bg-white/5 hover:text-white text-gray-400 transition-all duration-200 border border-transparent hover:border-gray-700/50 group"
          >
            <Settings className="w-5 h-5 group-hover:rotate-90 transition-transform duration-300" />
          </button>
        </div>
      </div>
      
      {/* Server List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2 relative z-10">
        {servers.length > 0 && (
          <div className="px-2 mb-3">
            <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">
              <Server className="w-3 h-3" />
              Servers ({servers.length})
              </div>
              {onPingAll && (
                <button
                  onClick={handlePingAll}
                  disabled={isPinging || isConnected}
                  className={clsx(
                    "p-1.5 rounded-lg transition-all duration-200",
                    isPinging || isConnected
                      ? "text-gray-600 cursor-not-allowed"
                      : "text-gray-400 hover:text-white hover:bg-white/5 border border-transparent hover:border-gray-700/50"
                  )}
                  title={isConnected ? "Disconnect to refresh ping" : "Refresh ping for all servers"}
                >
                  <RefreshCw className={clsx("w-3.5 h-3.5", isPinging && "animate-spin")} />
                </button>
              )}
            </div>
          </div>
        )}
        
        {servers.map((server, idx) => (
          <div
            key={idx}
            data-testid={`server-item-${idx}`}
            onClick={() => !isConnected && onSelectServer(server)}
            className={clsx(
              "group p-3.5 rounded-xl cursor-pointer transition-all duration-200 border relative overflow-hidden",
              selectedServer === server 
                ? "bg-gradient-to-br from-primary/20 via-primary/15 to-primary/10 border-primary/40 text-white shadow-lg shadow-primary/20" 
                : "bg-gradient-to-br from-gray-800/30 to-gray-800/20 hover:from-gray-700/40 hover:to-gray-700/30 text-gray-300 border-gray-700/30 hover:border-gray-600/50",
              isConnected && selectedServer !== server && "opacity-50 cursor-not-allowed"
            )}
          >
            {/* Hover gradient effect */}
            {selectedServer !== server && (
              <div className="absolute inset-0 bg-gradient-to-r from-primary/0 via-primary/5 to-primary/0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />
            )}
            
            <div className="flex items-center gap-3 relative z-10">
              <div className={clsx(
                "w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-200 shadow-lg overflow-hidden",
                selectedServer === server
                  ? "bg-gradient-to-br from-primary/30 to-primary/20 border border-primary/40 ring-2 ring-primary/30"
                  : "bg-gradient-to-br from-gray-700/50 to-gray-800/50 border border-gray-600/30 group-hover:from-gray-600/50 group-hover:to-gray-700/50 group-hover:ring-1 group-hover:ring-gray-500/30"
              )}>
                <CountryFlag server={server} size={28} className="rounded-sm" />
              </div>
              <div className="flex-1 overflow-hidden min-w-0">
                <div className="flex items-center justify-between gap-2">
                <div className={clsx(
                  "font-semibold truncate text-sm mb-0.5 transition-colors",
                  selectedServer === server ? "text-white" : "text-gray-200 group-hover:text-white"
                )}>
                  {server.name}
                  </div>
                  {server.ping !== null && server.ping !== undefined && (
                    <div className={clsx(
                      "text-xs font-semibold px-1.5 py-0.5 rounded flex-shrink-0",
                      server.ping < 100 ? "text-green-400 bg-green-500/10" :
                      server.ping < 200 ? "text-yellow-400 bg-yellow-500/10" :
                      server.ping < 300 ? "text-orange-400 bg-orange-500/10" :
                      "text-red-400 bg-red-500/10"
                    )}>
                      {server.ping}ms
                    </div>
                  )}
                  {server.ping === null && (
                    <div className="text-xs text-gray-500 flex-shrink-0">
                      —
                    </div>
                  )}
                </div>
                <div className="text-xs text-gray-500 truncate font-mono">
                  {server.address}
                </div>
              </div>
            </div>
          </div>
        ))}

        {servers.length === 0 && (
          <div className="flex flex-col items-center justify-center p-8 text-center">
            <div className="p-4 rounded-xl bg-gray-800/30 border border-gray-700/30 mb-4">
              <Server className="w-8 h-8 text-gray-500" />
            </div>
            <p className="text-gray-400 text-sm font-medium mb-1">No servers found</p>
            <p className="text-gray-500 text-xs">Add a subscription URL in settings</p>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="relative z-10 p-4 border-t border-gray-800/50 bg-gradient-to-r from-surface to-surface/95 backdrop-blur-sm">
        <div className="flex items-center justify-between">
          {appVersion && (
            <div className="text-xs text-gray-500 font-medium">
              v{appVersion}
            </div>
          )}
          {isConnected && (
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse shadow-lg shadow-green-500/50" />
              <span className="text-xs text-green-400 font-medium">Connected</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

