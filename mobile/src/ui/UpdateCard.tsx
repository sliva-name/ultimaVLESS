import React, { useState } from 'react';
import clsx from 'clsx';
import { Download } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useUpdateStatus } from '@/renderer/hooks/useUpdateStatus';

/**
 * The background APK download: progress while it loads, then the button
 * that opens the system installer.
 */
export const UpdateCard: React.FC<{ className?: string }> = ({ className }) => {
  const { t } = useTranslation();
  const { status, installUpdate } = useUpdateStatus();
  const [installFailed, setInstallFailed] = useState(false);

  if (
    !status ||
    (status.stage !== 'available' &&
      status.stage !== 'downloading' &&
      status.stage !== 'downloaded')
  ) {
    return null;
  }
  const version = status.version ?? '';
  const ready = status.stage === 'downloaded';
  const loading = status.stage === 'downloading';
  const percent = Math.max(0, Math.min(100, Math.round(status.percent ?? 0)));

  const title = installFailed
    ? t('status.update.installFailed')
    : ready
      ? t('mobile.update.ready', { version })
      : loading
        ? t('mobile.update.downloading', { version, percent })
        : t('mobile.update.available', { version });

  return (
    <div
      role="status"
      className={clsx(
        'shrink-0 flex items-center gap-3 py-2.5 pr-2.5 pl-3.5 rounded-xl bg-acc-soft border border-acc-line',
        className,
      )}
    >
      <Download
        aria-hidden
        strokeWidth={2}
        className="w-[18px] h-[18px] shrink-0 text-acc"
      />
      <div className="flex-1 min-w-0 flex flex-col gap-1.5">
        <span className="text-[13px] leading-[18px] font-medium">{title}</span>
        {loading && (
          <span
            aria-hidden="true"
            className="block h-1 rounded-sm bg-acc-line overflow-hidden"
          >
            <span
              className="block h-1 rounded-sm bg-acc transition-[width] duration-300"
              style={{ width: `${percent}%` }}
            />
          </span>
        )}
      </div>
      {ready && (
        <button
          type="button"
          onClick={() => {
            setInstallFailed(false);
            installUpdate().catch((error: unknown) => {
              console.error('Failed to install update', error);
              setInstallFailed(true);
            });
          }}
          className="shrink-0 h-9 px-3.5 rounded-[10px] bg-acc-fill text-white text-[13px] leading-4 font-medium"
        >
          {t('mobile.update.install')}
        </button>
      )}
    </div>
  );
};
