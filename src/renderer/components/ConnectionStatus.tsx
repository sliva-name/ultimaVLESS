import React from 'react';
import { VlessConfig } from '@/shared/types';
import {
  isSessionPhaseInFlight,
  type SessionPhase,
  type TrafficSnapshot,
} from '@/shared/ipc';
import {
  Power,
  Shield,
  Globe,
  Zap,
  CheckCircle2,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { ConnectionSessionStats } from './ConnectionSessionStats';
import { useRenderPerf } from '@/renderer/hooks/useRenderPerf';
import clsx from 'clsx';
import { CountryFlag } from './CountryFlag';
import { useTranslation } from 'react-i18next';

interface ConnectionStatusProps {
  phase: SessionPhase;
  selectedServer: VlessConfig | null;
  connectionError?: string | null;
  trafficSnapshot?: TrafficSnapshot | null;
  onToggleConnection: () => void;
}

function getProtocolLabel(server: VlessConfig): string {
  if (server.security === 'reality') return 'REALITY';
  switch (server.protocol) {
    case 'trojan':
      return 'TROJAN';
    case 'shadowsocks':
      return 'SHADOWSOCKS';
    case 'hysteria':
      return 'HYSTERIA';
    case 'wireguard':
      return 'WIREGUARD';
    case 'vless':
    case undefined:
      return 'VLESS';
    default:
      return String(server.protocol).toUpperCase();
  }
}

export const ConnectionStatus: React.FC<ConnectionStatusProps> = ({
  phase,
  selectedServer,
  connectionError,
  trafficSnapshot = null,
  onToggleConnection,
}) => {
  const { t } = useTranslation();
  const isSwitching = phase === 'switching';
  const isDisconnecting = phase === 'disconnecting';
  const isConnecting = phase === 'connecting';
  const inFlight = isSessionPhaseInFlight(phase);
  const showSecure = phase === 'connected';
  const busyLabel = isDisconnecting
    ? t('status.disconnecting')
    : isSwitching
      ? t('status.switchingServer')
      : t('status.connecting');
  const busyHint = isDisconnecting
    ? t('status.disconnectingHint')
    : t('status.connectingHint');
  const sessionActive = showSecure && !!trafficSnapshot;

  useRenderPerf('ConnectionStatus', [
    phase,
    selectedServer?.uuid,
    connectionError,
    sessionActive,
  ]);

  return (
    <div className="flex-1 relative min-h-0 min-w-0 overflow-x-hidden overflow-y-auto">
      {/* Background decorative elements — fixed to the scroll viewport
          so they don't scroll with the content. */}
      <div className="pointer-events-none sticky top-0 left-0 h-0 w-full z-0">
        <div className="absolute inset-0 bg-linear-to-br from-primary/5 via-transparent to-transparent" />
        <div
          className={clsx(
            'absolute inset-0 opacity-0 transition-opacity duration-1000',
            showSecure && 'opacity-100',
          )}
        >
          <div className="absolute inset-0 connection-ambient-glow" />
        </div>
      </div>

      {/* Inner wrapper: centers content when it fits, otherwise allows
          scrolling with both top and bottom reachable. */}
      <div className="min-h-full flex flex-col items-center justify-center p-4 sm:p-6 md:p-8">
        <div className="relative z-10 flex flex-col items-center max-w-2xl w-full px-1">
          {/* Status Text */}
          <div className="mb-4 sm:mb-6 text-center animate-[fadeIn_0.5s_ease-out] w-full">
            <div className="flex flex-nowrap items-center justify-center gap-2 sm:gap-3 mb-3 sm:mb-4 min-h-[3.5rem] sm:min-h-[4.5rem] md:min-h-[5rem]">
              {isSwitching ? (
                <>
                  <div className="shrink-0 p-2 sm:p-3 rounded-xl bg-amber-500/20 border border-amber-500/30 shadow-lg shadow-amber-500/20">
                    <RefreshCw className="w-6 h-6 sm:w-8 sm:h-8 text-amber-400 animate-spin" />
                  </div>
                  <div className="text-4xl sm:text-5xl md:text-6xl font-black tracking-tight leading-[1.1] pb-1 bg-linear-to-r from-amber-400 to-yellow-500 bg-clip-text text-transparent">
                    {t('status.switching')}
                  </div>
                </>
              ) : showSecure ? (
                <>
                  <div className="shrink-0 p-2 sm:p-3 rounded-xl bg-green-500/20 border border-green-500/30 shadow-lg shadow-green-500/20">
                    <CheckCircle2 className="w-6 h-6 sm:w-8 sm:h-8 text-green-400" />
                  </div>
                  <div className="text-4xl sm:text-5xl md:text-6xl font-black tracking-tight leading-[1.1] pb-1 bg-linear-to-r from-green-400 to-green-500 bg-clip-text text-transparent">
                    {t('status.secure')}
                  </div>
                </>
              ) : inFlight ? (
                <>
                  <div className="shrink-0 p-2 sm:p-3 rounded-xl bg-primary/15 border border-primary/30 shadow-lg shadow-primary/10">
                    <Loader2 className="w-6 h-6 sm:w-8 sm:h-8 text-primary animate-spin" />
                  </div>
                  <div className="text-4xl sm:text-5xl md:text-6xl font-black tracking-tight leading-[1.1] pb-1 bg-linear-to-r from-primary to-sky-400 bg-clip-text text-transparent">
                    {isDisconnecting
                      ? t('status.disconnecting')
                      : t('status.connecting')}
                  </div>
                </>
              ) : (
                <>
                  <div className="shrink-0 p-2 sm:p-3 rounded-xl bg-gray-800/50 border border-gray-700/50">
                    <Shield className="w-6 h-6 sm:w-8 sm:h-8 text-gray-500" />
                  </div>
                  <div className="text-4xl sm:text-5xl md:text-6xl font-black tracking-tight leading-[1.1] pb-1 text-gray-500">
                    {t('status.disconnected')}
                  </div>
                </>
              )}
            </div>
            <p className="text-gray-400 text-base sm:text-lg font-medium px-2 min-h-[1.75rem] sm:min-h-[2rem]">
              {isSwitching
                ? t('status.switchingServer')
                : inFlight
                  ? busyLabel
                  : showSecure
                    ? t('status.connectedTo', {
                        name: selectedServer?.name || 'server',
                      })
                    : selectedServer
                      ? t('status.readyToConnect', {
                          name: selectedServer.name,
                        })
                      : t('status.selectServer')}
            </p>
          </div>

          {/* Main Connection Button */}
          <div className="relative mb-6 sm:mb-8">
            {/* Pulsing rings when connected — softer scale so they don't
              visually overlap the status text above the button. */}
            {showSecure && (
              <>
                <div className="absolute inset-0 rounded-full border-4 border-green-500/30 animate-ping-soft pointer-events-none" />
                <div className="absolute inset-0 rounded-full border-4 border-green-500/20 animate-ping-soft pointer-events-none [animation-delay:700ms]" />
              </>
            )}

            <button
              onClick={onToggleConnection}
              disabled={!selectedServer || inFlight}
              className={clsx(
                'relative w-40 h-40 sm:w-48 sm:h-48 md:w-56 md:h-56 rounded-full border-[6px] sm:border-8 flex items-center justify-center transition-all duration-500 shadow-2xl transform',
                !(!selectedServer || inFlight) &&
                  'hover:scale-105 active:scale-95',
                showSecure
                  ? 'bg-linear-to-br from-green-500/20 to-green-600/10 border-green-500 shadow-green-500/30'
                  : 'bg-linear-to-br from-gray-800/50 to-gray-800/30 border-gray-700 shadow-black/30',
                !(!selectedServer || inFlight) &&
                  (showSecure
                    ? 'hover:shadow-green-500/40'
                    : 'hover:border-gray-600 hover:from-gray-700/60 hover:to-gray-700/40 hover:shadow-black/40'),
                (!selectedServer || inFlight) && 'opacity-50 cursor-not-allowed',
              )}
            >
              <div
                className={clsx(
                  'absolute inset-0 rounded-full bg-linear-to-br opacity-0 transition-opacity duration-300',
                  showSecure
                    ? 'from-green-500/10 to-transparent'
                    : 'from-primary/10 to-transparent',
                  'hover:opacity-100',
                )}
              />

              <Power
                className={clsx(
                  'relative z-10 w-16 h-16 sm:w-20 sm:h-20 md:w-24 md:h-24 transition-all duration-500',
                  showSecure
                    ? 'text-green-400 drop-shadow-lg shadow-green-500/50'
                    : 'text-gray-400 group-hover:text-gray-300',
                )}
              />

              {inFlight && (
                <div className="absolute inset-0 flex items-center justify-center z-20 rounded-full bg-black/35">
                  <Loader2 className="w-10 h-10 sm:w-12 sm:h-12 md:w-14 md:h-14 text-white animate-spin" />
                </div>
              )}
            </button>
          </div>

          {/* Reserved slot for busy hint so the layout stays stable when
            transitioning between connecting/connected/disconnected. */}
          <div className="mb-4 sm:mb-6 min-h-[2.25rem] sm:min-h-[2.5rem] flex items-center justify-center">
            {inFlight && !isSwitching && (
              <div className="flex items-center gap-2 px-3 sm:px-4 py-2 rounded-full bg-primary/10 border border-primary/30 animate-[fadeIn_0.3s_ease-out] max-w-md text-center justify-center">
                <Loader2 className="w-4 h-4 text-primary animate-spin shrink-0" />
                <span className="text-xs sm:text-sm text-primary font-medium leading-snug">
                  {busyHint}
                </span>
              </div>
            )}
          </div>

          {/* Server Info Cards */}
          {selectedServer && (
            <div
              className={clsx(
                'grid grid-cols-1 sm:grid-cols-3 gap-3 w-full max-w-2xl transition-all duration-500 animate-[fadeIn_0.5s_ease-out]',
                showSecure || isConnecting ? 'opacity-100' : 'opacity-60',
              )}
            >
              <div className="p-4 sm:p-5 rounded-xl bg-linear-to-br from-gray-800/50 to-gray-800/30 border border-gray-700/50 hover:border-gray-600/70 transition-all duration-200 hover:shadow-lg hover:shadow-black/20">
                <div className="flex items-center gap-2 mb-3">
                  <CountryFlag
                    server={selectedServer}
                    size={24}
                    className="rounded-sm"
                  />
                  <div className="text-xs text-gray-400 uppercase tracking-wider font-semibold">
                    {t('status.country')}
                  </div>
                </div>
                <div className="text-base sm:text-lg text-white font-semibold truncate">
                  {selectedServer.name}
                </div>
              </div>

              <div className="p-4 sm:p-5 rounded-xl bg-linear-to-br from-gray-800/50 to-gray-800/30 border border-gray-700/50 hover:border-gray-600/70 transition-all duration-200 hover:shadow-lg hover:shadow-black/20">
                <div className="flex items-center gap-2 mb-3">
                  <Globe className="w-4 h-4 text-gray-400" />
                  <div className="text-xs text-gray-400 uppercase tracking-wider font-semibold">
                    {t('status.ipAddress')}
                  </div>
                </div>
                <div className="font-mono text-base sm:text-lg text-white font-semibold truncate">
                  {selectedServer.address}
                </div>
              </div>

              <div className="p-4 sm:p-5 rounded-xl bg-linear-to-br from-gray-800/50 to-gray-800/30 border border-gray-700/50 hover:border-gray-600/70 transition-all duration-200 hover:shadow-lg hover:shadow-black/20">
                <div className="flex items-center gap-2 mb-3">
                  <Zap className="w-4 h-4 text-primary" />
                  <div className="text-xs text-gray-400 uppercase tracking-wider font-semibold">
                    {t('status.protocol')}
                  </div>
                </div>
                <div className="font-mono text-base sm:text-lg font-semibold bg-linear-to-r from-primary to-blue-400 bg-clip-text text-transparent">
                  {getProtocolLabel(selectedServer)}
                </div>
              </div>
            </div>
          )}

          {/* Connection Status Indicator — reserved slot keeps the layout
            from jumping when the pill appears on connect. */}
          <div className="mt-5 sm:mt-6 min-h-[2.25rem] flex items-center justify-center">
            {isSwitching ? (
              <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-amber-500/10 border border-amber-500/30 animate-[fadeIn_0.5s_ease-out]">
                <RefreshCw className="w-3.5 h-3.5 text-amber-400 animate-spin" />
                <span className="text-sm text-amber-300 font-medium">
                  {t('status.switchingServer')}
                </span>
              </div>
            ) : (
              showSecure && (
                <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-green-500/10 border border-green-500/30 animate-[fadeIn_0.5s_ease-out]">
                  <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse shadow-lg shadow-green-500/50" />
                  <span className="text-sm text-green-400 font-medium">
                    {t('status.connectionActive')}
                  </span>
                </div>
              )
            )}
          </div>

          {sessionActive && (
            <ConnectionSessionStats trafficSnapshot={trafficSnapshot} />
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
    </div>
  );
};
