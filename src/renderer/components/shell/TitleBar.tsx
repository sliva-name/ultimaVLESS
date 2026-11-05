import React, { useState } from 'react';
import clsx from 'clsx';
import { Download } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ConnectionMode } from '@/shared/types';
import type { UpdateStatus } from '@/shared/ipc';
import logoUrl from '@/renderer/assets/logo.svg';

interface TitleBarProps {
  mode: ConnectionMode;
  /** In-flight sessions keep their mode until they settle. */
  modeDisabled: boolean;
  onMode: (mode: ConnectionMode) => void;
  update: UpdateStatus | null;
  onInstallUpdate: () => Promise<unknown>;
}

const MODES: { mode: ConnectionMode; label: string; title: string }[] = [
  {
    mode: 'proxy',
    label: 'shell.modeProxy',
    title: 'shell.modeProxyTitle',
  },
  { mode: 'tun', label: 'shell.modeTun', title: 'shell.modeTunTitle' },
];

/**
 * The window's own 40 px title bar: logo, the Proxy/TUN switch in the
 * middle, the update chip and room for the native window buttons, which the
 * titlebar-area env() values describe.
 */
export const TitleBar: React.FC<TitleBarProps> = ({
  mode,
  modeDisabled,
  onMode,
  update,
  onInstallUpdate,
}) => {
  const { t } = useTranslation();

  return (
    <header
      className="app-drag h-10 shrink-0 flex items-center bg-bar border-b border-bar-line select-none"
      style={{
        paddingLeft: 'env(titlebar-area-x, 0px)',
        paddingRight:
          'calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw))',
      }}
    >
      <div className="flex-1 basis-0 min-w-0 flex items-center gap-2 pl-3">
        <img
          src={logoUrl}
          alt=""
          draggable={false}
          className="w-4 h-4 shrink-0 rounded-[4px]"
        />
        <span className="text-[13px] leading-4 font-semibold tracking-[-0.01em] whitespace-nowrap">
          {t('app.title')}
        </span>
      </div>

      <div
        role="radiogroup"
        aria-label={t('shell.modeAria')}
        className="app-no-drag h-7 box-border flex items-center gap-0.5 p-0.5 rounded-lg bg-bar-seg border border-bar-line"
      >
        {MODES.map((option) => {
          const on = option.mode === mode;
          return (
            <button
              key={option.mode}
              type="button"
              role="radio"
              aria-checked={on}
              title={t(option.title)}
              disabled={modeDisabled}
              onClick={() => onMode(option.mode)}
              className={clsx(
                'h-[22px] px-3 rounded-md text-xs leading-4 font-medium',
                'transition-[background-color,color] duration-150 disabled:opacity-50',
                on ? 'bg-thumb text-fg shadow-thumb' : 'text-fg2 hover:text-fg',
              )}
            >
              {t(option.label)}
            </button>
          );
        })}
      </div>

      <div className="flex-1 basis-0 min-w-0 flex items-center justify-end gap-2 pr-2">
        <UpdateChip update={update} onInstall={onInstallUpdate} />
      </div>
    </header>
  );
};

const UpdateChip: React.FC<{
  update: UpdateStatus | null;
  onInstall: () => Promise<unknown>;
}> = ({ update, onInstall }) => {
  const { t } = useTranslation();
  const [installing, setInstalling] = useState(false);
  if (!update) return null;
  const version = update.version ?? '';
  const chip =
    'app-no-drag h-6 min-w-0 inline-flex items-center gap-1.5 px-2 rounded-md border border-acc-line bg-acc-soft text-acc-nav text-xs leading-4 font-normal whitespace-nowrap';

  if (update.stage === 'downloaded') {
    return (
      <button
        type="button"
        title={t('shell.update.readyTitle', { version })}
        disabled={installing}
        onClick={() => {
          setInstalling(true);
          onInstall()
            .catch((error: unknown) => {
              console.error('Failed to install update', error);
            })
            .finally(() => setInstalling(false));
        }}
        className={clsx(chip, 'hover:brightness-110 disabled:opacity-60')}
      >
        <Download
          aria-hidden
          strokeWidth={2}
          className="w-3.5 h-3.5 shrink-0"
        />
        <span className="truncate">{t('shell.update.ready', { version })}</span>
      </button>
    );
  }
  if (update.stage === 'downloading' || update.stage === 'available') {
    const text =
      update.stage === 'downloading'
        ? t('shell.update.downloading', {
            version,
            percent: Math.round(update.percent ?? 0),
          })
        : t('shell.update.available', { version });
    return (
      <span role="status" className={chip} title={text}>
        <Download
          aria-hidden
          strokeWidth={2}
          className="w-3.5 h-3.5 shrink-0"
        />
        <span className="truncate">{text}</span>
      </span>
    );
  }
  return null;
};
