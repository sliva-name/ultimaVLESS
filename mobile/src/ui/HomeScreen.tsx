import React, { useCallback, useState } from 'react';
import clsx from 'clsx';
import { ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ConnectionMode, VlessConfig } from '@/shared/types';
import type { SessionPhase, TrafficSnapshot } from '@/shared/ipc';
import { localizeError } from '@/shared/localizeError';
import logoUrl from '@/renderer/assets/logo.svg';
import { ConnectionStatus } from '@/renderer/components/ConnectionStatus';
import { CountryFlag } from '@/renderer/components/CountryFlag';
import { UpdateBanner } from '@/renderer/components/UpdateBanner';

interface HomeScreenProps {
  phase: SessionPhase;
  connectionMode: ConnectionMode;
  isConnectionBusy: boolean;
  selectedServer: VlessConfig | null;
  connectionError: string | null;
  trafficSnapshot: TrafficSnapshot | null;
  onToggleConnection: () => void;
  onChooseServer: () => void;
}

const MODES: { mode: ConnectionMode; labelKey: string }[] = [
  { mode: 'tun', labelKey: 'mobile.modeVpn' },
  { mode: 'proxy', labelKey: 'mobile.modeProxy' },
];

/** VPN / proxy-only switch; a connected session restarts in the new mode. */
const ModeSwitch: React.FC<{
  mode: ConnectionMode;
  disabled: boolean;
  onError: (message: string | null) => void;
}> = ({ mode, disabled, onError }) => {
  const { t } = useTranslation();
  const [pending, setPending] = useState<ConnectionMode | null>(null);

  const choose = useCallback(
    async (next: ConnectionMode) => {
      if (next === mode || disabled) return;
      onError(null);
      setPending(next);
      try {
        await window.electronAPI.setConnectionMode(next);
      } catch (error) {
        onError(error instanceof Error ? error.message : String(error));
      } finally {
        setPending(null);
      }
    },
    [mode, disabled, onError],
  );

  const shown = pending ?? mode;
  return (
    <div
      role="radiogroup"
      className="flex shrink-0 rounded-xl border border-gray-700/50 bg-black/40 p-1"
    >
      {MODES.map(({ mode: option, labelKey }) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={shown === option}
          disabled={disabled}
          onClick={() => void choose(option)}
          className={clsx(
            'px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50',
            shown === option
              ? 'bg-primary/25 text-white'
              : 'text-gray-400 active:text-gray-200',
          )}
        >
          {t(labelKey)}
        </button>
      ))}
    </div>
  );
};

export const HomeScreen: React.FC<HomeScreenProps> = ({
  phase,
  connectionMode,
  isConnectionBusy,
  selectedServer,
  connectionError,
  trafficSnapshot,
  onToggleConnection,
  onChooseServer,
}) => {
  const { t, i18n } = useTranslation();
  const [modeError, setModeError] = useState<string | null>(null);

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <header className="mobile-top-bar shrink-0 flex items-center justify-between gap-3 px-4 pb-3 border-b border-gray-800/50 bg-linear-to-r from-surface/80 to-transparent">
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-1.5 rounded-xl bg-linear-to-br from-primary/20 to-primary/10 border border-primary/30">
            <img src={logoUrl} alt="" className="w-7 h-7 rounded-lg" />
          </div>
          <div className="min-w-0">
            <h1 className="font-bold text-base text-white tracking-tight truncate">
              {t('app.title')}
            </h1>
            <p className="text-[11px] text-gray-400 truncate">
              {t('app.subtitle')}
            </p>
          </div>
        </div>
        <ModeSwitch
          mode={connectionMode}
          disabled={isConnectionBusy}
          onError={setModeError}
        />
      </header>

      <UpdateBanner />

      <button
        type="button"
        onClick={onChooseServer}
        className="shrink-0 mx-4 mt-3 flex items-center gap-3 rounded-xl border border-gray-700/50 bg-gray-800/40 px-3.5 py-3 text-left active:bg-gray-700/40 transition-colors"
      >
        {selectedServer ? (
          <CountryFlag
            server={selectedServer}
            size={28}
            className="rounded-sm shrink-0"
          />
        ) : null}
        <div className="flex-1 min-w-0">
          <div className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold">
            {t('mobile.selectedServer')}
          </div>
          <div className="text-sm text-white font-semibold truncate">
            {selectedServer?.name ?? t('mobile.noServerSelected')}
          </div>
        </div>
        {selectedServer?.ping != null && (
          <span className="text-xs font-semibold text-gray-300 shrink-0">
            {selectedServer.ping} {t('sidebar.ms')}
          </span>
        )}
        <ChevronRight className="w-5 h-5 text-gray-500 shrink-0" />
      </button>

      {modeError && (
        <p className="shrink-0 mx-4 mt-2 text-xs text-orange-400 leading-relaxed">
          {localizeError(modeError, i18n.language)}
        </p>
      )}
      {connectionMode === 'proxy' && phase === 'connected' && (
        <p className="shrink-0 mx-4 mt-2 text-xs text-gray-400 font-mono text-center">
          {t('mobile.proxyEndpoints')}
        </p>
      )}

      <ConnectionStatus
        phase={phase}
        selectedServer={selectedServer}
        connectionError={connectionError}
        trafficSnapshot={trafficSnapshot}
        onToggleConnection={onToggleConnection}
      />
    </div>
  );
};
