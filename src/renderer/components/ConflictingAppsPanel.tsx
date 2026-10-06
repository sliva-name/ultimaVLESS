import React from 'react';
import clsx from 'clsx';
import { AlertTriangle, Check, Loader2, RefreshCw, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ConflictingAppView, ConflictingAppsScan } from '@/shared/ipc';

interface ConflictingAppsPanelProps {
  scan: ConflictingAppsScan | null;
  scanning: boolean;
  error: string | null;
  closingIds: ReadonlySet<string>;
  failedIds: ReadonlySet<string>;
  onCloseApp: (appId: string) => void;
  onRescan: () => void;
  onDismiss?: () => void;
  /** Render a "nothing found" line instead of nothing when the scan is clean. */
  showEmptyState?: boolean;
  /** Shown instead of the empty state once the user closed everything found. */
  resolved?: boolean;
  className?: string;
}

function uniqueImages(app: ConflictingAppView): string {
  return [
    ...new Set([...app.processes, ...app.services].map((proc) => proc.image)),
  ].join(', ');
}

/**
 * Other VPN/proxy software that breaks TUN, with a per-app "Close" action.
 * Shared by the main-screen notice and the diagnostics tab.
 */
export const ConflictingAppsPanel: React.FC<ConflictingAppsPanelProps> = ({
  scan,
  scanning,
  error,
  closingIds,
  failedIds,
  onCloseApp,
  onRescan,
  onDismiss,
  showEmptyState = false,
  resolved = false,
  className,
}) => {
  const { t } = useTranslation();
  const apps = scan?.apps ?? [];

  if (scan && !scan.supported) return null;

  if (apps.length === 0) {
    if (error) {
      return (
        <p className={clsx('text-sm text-orange-400', className)}>
          {t('conflicts.scanFailed', { error })}
        </p>
      );
    }
    if (!scan || !(showEmptyState || resolved)) {
      return scanning && showEmptyState ? (
        <div
          className={clsx(
            'flex items-center gap-2 text-sm text-gray-400',
            className,
          )}
        >
          <Loader2 className="w-4 h-4 animate-spin" />
          {t('conflicts.scanning')}
        </div>
      ) : null;
    }
    return (
      <div
        role="status"
        className={clsx(
          'flex items-center gap-2.5 rounded-xl border border-green-500/25 bg-green-500/10 px-3 py-2 text-sm text-green-300',
          className,
        )}
      >
        <Check className="w-4 h-4 shrink-0" />
        <span className="flex-1 min-w-0 leading-relaxed">
          {resolved ? t('conflicts.resolved') : t('conflicts.none')}
        </span>
        {onDismiss ? (
          <DismissButton label={t('conflicts.dismiss')} onClick={onDismiss} />
        ) : (
          <RescanButton
            label={t('conflicts.rescan')}
            scanning={scanning}
            onClick={onRescan}
          />
        )}
      </div>
    );
  }

  return (
    <div
      role="alert"
      className={clsx(
        'rounded-xl border border-orange-500/30 bg-orange-500/10 p-4 space-y-3 text-left',
        className,
      )}
    >
      <div className="flex items-start gap-2.5">
        <AlertTriangle className="w-4 h-4 text-orange-400 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-orange-200">
            {t('conflicts.title')}
          </div>
          <div className="text-xs text-orange-200/80 leading-relaxed mt-0.5">
            {t('conflicts.hint')}
          </div>
        </div>
        {onDismiss && (
          <DismissButton label={t('conflicts.dismiss')} onClick={onDismiss} />
        )}
      </div>

      <ul className="space-y-2">
        {apps.map((app) => {
          const closing = closingIds.has(app.id);
          const failed = failedIds.has(app.id);
          return (
            <li
              key={app.id}
              className="flex items-start justify-between gap-3 rounded-lg border border-gray-700/40 bg-black/25 px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-gray-100">
                    {app.name}
                  </span>
                  <span className="rounded bg-gray-700/50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-gray-300">
                    {t(`conflicts.category.${app.category}`)}
                  </span>
                </div>
                <div
                  className="mt-0.5 truncate font-mono text-xs text-gray-500"
                  title={uniqueImages(app)}
                >
                  {uniqueImages(app)}
                </div>
                {app.services.length > 0 && (
                  <div className="mt-1 text-xs leading-relaxed text-gray-400">
                    {app.processes.length > 0
                      ? t('conflicts.serviceKeepsRunning')
                      : t('conflicts.serviceOnly')}
                  </div>
                )}
                {failed && (
                  <div className="mt-1 text-xs leading-relaxed text-orange-300">
                    {t('conflicts.closeFailed')}
                  </div>
                )}
              </div>
              {app.processes.length > 0 && (
                <button
                  type="button"
                  onClick={() => onCloseApp(app.id)}
                  disabled={closing}
                  className="flex shrink-0 items-center gap-1.5 rounded-lg border border-orange-500/40 px-3 py-1.5 text-xs font-medium text-orange-100 transition-colors hover:bg-orange-500/15 disabled:cursor-wait disabled:opacity-60"
                >
                  {closing && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {closing ? t('conflicts.closing') : t('conflicts.close')}
                </button>
              )}
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs leading-relaxed text-gray-400">
          {t('conflicts.reconnectHint')}
        </p>
        <RescanButton
          label={t('conflicts.rescan')}
          scanning={scanning}
          onClick={onRescan}
        />
      </div>
      {error && (
        <p className="text-xs text-orange-300">
          {t('conflicts.scanFailed', { error })}
        </p>
      )}
    </div>
  );
};

const DismissButton: React.FC<{ label: string; onClick: () => void }> = ({
  label,
  onClick,
}) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={label}
    title={label}
    className="shrink-0 rounded-md p-1 text-gray-400 transition-colors hover:bg-white/5 hover:text-gray-200"
  >
    <X className="w-4 h-4" />
  </button>
);

const RescanButton: React.FC<{
  label: string;
  scanning: boolean;
  onClick: () => void;
}> = ({ label, scanning, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={scanning}
    className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-primary transition-colors hover:text-blue-400 disabled:opacity-50"
  >
    <RefreshCw className={clsx('w-3.5 h-3.5', scanning && 'animate-spin')} />
    {label}
  </button>
);
