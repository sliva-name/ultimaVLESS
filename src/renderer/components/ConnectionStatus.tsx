import React from 'react';
import { VlessConfig } from '../../shared/types';
import { Power, Shield, Globe, Zap, CheckCircle2, Loader2 } from 'lucide-react';
import clsx from 'clsx';
import { CountryFlag } from './CountryFlag';

interface ConnectionStatusProps {
  isConnected: boolean;
  isBusy?: boolean;
  selectedServer: VlessConfig | null;
  connectionError?: string | null;
  onToggleConnection: () => void;
}

export const ConnectionStatus: React.FC<ConnectionStatusProps> = ({ 
  isConnected, 
  isBusy = false,
  selectedServer, 
  connectionError,
  onToggleConnection 
}) => {
  const busyLabel = isConnected ? 'Disconnecting...' : 'Connecting...';
  const busyHint = isConnected
    ? 'Applying disconnect sequence and cleaning routes.'
    : 'Applying TUN/proxy settings and network routes. This can take a few seconds.';

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 relative overflow-hidden">
      {/* Background decorative elements */}
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent pointer-events-none" />
      <div className={clsx(
        "absolute inset-0 opacity-0 transition-opacity duration-1000 pointer-events-none",
        isConnected && "opacity-100"
      )}>
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-green-500/5 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-primary/5 rounded-full blur-3xl animate-pulse delay-1000" />
      </div>

      <div className="relative z-10 flex flex-col items-center max-w-2xl w-full">
        {/* Status Text */}
        <div className="mb-8 text-center animate-[fadeIn_0.5s_ease-out]">
          <div className="flex items-center justify-center gap-3 mb-4">
            {isConnected ? (
              <>
                <div className="p-3 rounded-xl bg-green-500/20 border border-green-500/30 shadow-lg shadow-green-500/20">
                  <CheckCircle2 className="w-8 h-8 text-green-400" />
                </div>
                <div className="text-6xl font-black tracking-tight bg-gradient-to-r from-green-400 to-green-500 bg-clip-text text-transparent">
                  SECURE
                </div>
              </>
            ) : (
              <>
                <div className="p-3 rounded-xl bg-gray-800/50 border border-gray-700/50">
                  <Shield className="w-8 h-8 text-gray-500" />
                </div>
                <div className="text-6xl font-black tracking-tight text-gray-500">
                  DISCONNECTED
                </div>
              </>
            )}
          </div>
          <p className="text-gray-400 text-lg font-medium">
            {isBusy
              ? busyLabel
              : isConnected 
                ? `Connected to ${selectedServer?.name || 'server'}` 
                : selectedServer 
                  ? `Ready to connect to ${selectedServer.name}` 
                  : 'Select a server to connect'}
          </p>
        </div>

        {/* Main Connection Button */}
        <div className="relative mb-12">
          {/* Pulsing rings when connected */}
          {isConnected && (
            <>
              <div className="absolute inset-0 rounded-full border-4 border-green-500/30 animate-ping" />
              <div className="absolute inset-0 rounded-full border-4 border-green-500/20 animate-ping delay-500" />
            </>
          )}
          
          <button
            onClick={onToggleConnection}
            disabled={!selectedServer || isBusy}
            className={clsx(
              "relative w-56 h-56 rounded-full border-8 flex items-center justify-center transition-all duration-500 shadow-2xl transform hover:scale-105 active:scale-95",
              isConnected 
                ? "bg-gradient-to-br from-green-500/20 to-green-600/10 border-green-500 shadow-green-500/30 hover:shadow-green-500/40" 
                : "bg-gradient-to-br from-gray-800/50 to-gray-800/30 border-gray-700 hover:border-gray-600 hover:from-gray-700/60 hover:to-gray-700/40 shadow-black/30 hover:shadow-black/40",
              (!selectedServer || isBusy) && "opacity-50 cursor-not-allowed hover:scale-100"
            )}
          >
            <div className={clsx(
              "absolute inset-0 rounded-full bg-gradient-to-br opacity-0 transition-opacity duration-300",
              isConnected ? "from-green-500/10 to-transparent" : "from-primary/10 to-transparent",
              "hover:opacity-100"
            )} />
            
            <Power className={clsx(
              "relative z-10 w-24 h-24 transition-all duration-500",
              isConnected 
                ? "text-green-400 drop-shadow-lg shadow-green-500/50" 
                : "text-gray-400 group-hover:text-gray-300"
            )} />

            {isBusy && (
              <div className="absolute inset-0 flex items-center justify-center z-20 rounded-full bg-black/35">
                <Loader2 className="w-14 h-14 text-white animate-spin" />
              </div>
            )}
          </button>
        </div>

        {isBusy && (
          <div className="mb-8 flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 border border-primary/30 backdrop-blur-sm animate-[fadeIn_0.3s_ease-out]">
            <Loader2 className="w-4 h-4 text-primary animate-spin" />
            <span className="text-sm text-primary font-medium">{busyHint}</span>
          </div>
        )}

        {/* Server Info Cards */}
        {selectedServer && (
          <div className={clsx(
            "grid grid-cols-3 gap-3 w-full max-w-2xl transition-all duration-500 animate-[fadeIn_0.5s_ease-out]",
            isConnected ? "opacity-100" : "opacity-60"
          )}>
            <div className="p-5 rounded-xl bg-gradient-to-br from-gray-800/50 to-gray-800/30 border border-gray-700/50 backdrop-blur-sm hover:border-gray-600/70 transition-all duration-200 hover:shadow-lg hover:shadow-black/20">
              <div className="flex items-center gap-2 mb-3">
                <CountryFlag server={selectedServer} size={24} className="rounded-sm" />
                <div className="text-xs text-gray-400 uppercase tracking-wider font-semibold">Country</div>
              </div>
              <div className="text-lg text-white font-semibold truncate">{selectedServer.name}</div>
            </div>
            
            <div className="p-5 rounded-xl bg-gradient-to-br from-gray-800/50 to-gray-800/30 border border-gray-700/50 backdrop-blur-sm hover:border-gray-600/70 transition-all duration-200 hover:shadow-lg hover:shadow-black/20">
              <div className="flex items-center gap-2 mb-3">
                <Globe className="w-4 h-4 text-gray-400" />
                <div className="text-xs text-gray-400 uppercase tracking-wider font-semibold">IP Address</div>
              </div>
              <div className="font-mono text-lg text-white font-semibold truncate">{selectedServer.address}</div>
            </div>
            
            <div className="p-5 rounded-xl bg-gradient-to-br from-gray-800/50 to-gray-800/30 border border-gray-700/50 backdrop-blur-sm hover:border-gray-600/70 transition-all duration-200 hover:shadow-lg hover:shadow-black/20">
              <div className="flex items-center gap-2 mb-3">
                <Zap className="w-4 h-4 text-primary" />
                <div className="text-xs text-gray-400 uppercase tracking-wider font-semibold">Protocol</div>
              </div>
              <div className="font-mono text-lg font-semibold bg-gradient-to-r from-primary to-blue-400 bg-clip-text text-transparent">
                {selectedServer.security === 'reality' ? 'REALITY' : 'VLESS'}
              </div>
            </div>
          </div>
        )}

        {/* Connection Status Indicator */}
        {isConnected && (
          <div className="mt-8 flex items-center gap-2 px-4 py-2 rounded-full bg-green-500/10 border border-green-500/30 backdrop-blur-sm animate-[fadeIn_0.5s_ease-out]">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse shadow-lg shadow-green-500/50" />
            <span className="text-sm text-green-400 font-medium">Connection Active</span>
          </div>
        )}

        {connectionError && (
          <div className="mt-6 w-full max-w-2xl p-4 rounded-xl bg-orange-500/10 border border-orange-500/30 animate-[fadeIn_0.3s_ease-out]">
            <div className="text-sm text-orange-300 font-medium break-words">
              {connectionError}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

