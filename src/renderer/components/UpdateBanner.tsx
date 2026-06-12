import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, RefreshCw, AlertTriangle, X } from 'lucide-react';
import { useUpdateStatus } from '@/renderer/hooks/useUpdateStatus';

/**
 * Lightweight non-blocking banner that surfaces the auto-updater state
 * (available / downloading / downloaded / error). Rendered at the top of the
 * main content area so it never hides the connection UI underneath.
 */
export const UpdateBanner: React.FC = () => {
  const { t } = useTranslation();
  const { status, dismissed, dismiss, installUpdate } = useUpdateStatus();
  const [installError, setInstallError] = useState<string | null>(null);

  if (!status || dismissed) return null;
  if (
    status.stage !== 'available' &&
    status.stage !== 'downloading' &&
    status.stage !== 'downloaded' &&
    status.stage !== 'error'
  ) {
    return null;
  }

  const handleInstall = () => {
    setInstallError(null);
    installUpdate().catch((error: unknown) => {
      console.error('Failed to install update', error);
      setInstallError(error instanceof Error ? error.message : String(error));
    });
  };

  let icon: React.ReactNode;
  let text: string;
  let tone: 'info' | 'success' | 'error';
  let action: React.ReactNode = null;

  if (status.stage === 'error') {
    tone = 'error';
    icon = <AlertTriangle className="w-4 h-4" />;
    text = status.error
      ? `${t('status.update.error')}: ${status.error}`
      : t('status.update.error');
  } else if (status.stage === 'downloaded') {
    tone = 'success';
    icon = <Download className="w-4 h-4" />;
    text = t('status.update.ready', { version: status.version ?? '' });
    action = (
      <button
        type="button"
        onClick={handleInstall}
        className="text-xs font-semibold px-2.5 py-1 rounded-md bg-green-500/20 text-green-200 hover:bg-green-500/30 transition-colors"
      >
        {t('status.update.restart')}
      </button>
    );
  } else if (status.stage === 'downloading') {
    tone = 'info';
    icon = <RefreshCw className="w-4 h-4 animate-spin" />;
    text = t('status.update.downloading', {
      version: status.version ?? '',
      percent: status.percent ?? 0,
    });
  } else {
    tone = 'info';
    icon = <Download className="w-4 h-4" />;
    text = t('status.update.available', { version: status.version ?? '' });
  }

  if (installError) {
    tone = 'error';
    icon = <AlertTriangle className="w-4 h-4" />;
    text = `${t('status.update.installFailed')}: ${installError}`;
  }

  const toneClass =
    tone === 'error'
      ? 'bg-orange-500/10 border-orange-500/30 text-orange-200'
      : tone === 'success'
        ? 'bg-green-500/10 border-green-500/30 text-green-200'
        : 'bg-primary/10 border-primary/30 text-primary';

  return (
    <div
      className={`z-20 mx-3 mt-2 rounded-xl border ${toneClass} px-3 py-2 flex items-center gap-2.5 animate-[fadeIn_0.3s_ease-out]`}
    >
      <span className="shrink-0">{icon}</span>
      <span className="text-xs flex-1 min-w-0 leading-snug break-words">
        {text}
      </span>
      {action}
      <button
        type="button"
        onClick={dismiss}
        aria-label={t('status.update.dismiss')}
        className="shrink-0 text-current/70 hover:text-current transition-colors"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};
