import React from 'react';
import clsx from 'clsx';
import { AlertTriangle, Check, Loader2, RefreshCw, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { localizeError } from '@/shared/localizeError';
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
 * Shared by the banner over the home stage and the diagnostics page.
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
  const { t, i18n } = useTranslation();
  const apps = scan?.apps ?? [];

  if (scan && !scan.supported) return null;

  if (apps.length === 0) {
    if (error) {
      return (
        <p className={clsx('m-0 text-xs leading-[18px] text-warn', className)}>
          {t('conflicts.scanFailed', {
            error: localizeError(error, i18n.language),
          })}
        </p>
      );
    }
    if (!scan || !(showEmptyState || resolved)) {
      return scanning && showEmptyState ? (
        <div
          className={clsx(
            'flex items-center gap-2 text-xs leading-4 text-fg2',
            className,
          )}
        >
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          {t('conflicts.scanning')}
        </div>
      ) : null;
    }
    return (
      <div
        role="status"
        className={clsx(
          'flex items-center gap-2.5 rounded-lg border border-ok-line bg-ok-soft px-3 py-2 text-xs leading-4 text-fg',
          className,
        )}
      >
        <Check className="w-4 h-4 shrink-0 text-ok" />
        <span className="flex-1 min-w-0">
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
        'rounded-xl border border-warn-line bg-warn-soft p-4 flex flex-col gap-3 text-left',
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <AlertTriangle
          strokeWidth={2}
          className="w-4 h-4 text-warn shrink-0 mt-0.5"
        />
        <div className="flex-1 min-w-0">
          <div className="text-sm leading-5 font-semibold text-fg">
            {t('conflicts.title')}
          </div>
          <div className="mt-1 text-[13px] leading-5 text-fg2">
            {t('conflicts.hint')}
          </div>
        </div>
        {onDismiss && (
          <DismissButton label={t('conflicts.dismiss')} onClick={onDismiss} />
        )}
      </div>

      <ul className="m-0 p-0 list-none flex flex-col gap-1.5">
        {apps.map((app) => {
          const closing = closingIds.has(app.id);
          const failed = failedIds.has(app.id);
          return (
            <li
              key={app.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-line bg-s1 px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] leading-5 font-medium text-fg">
                    {app.name}
                  </span>
                  <span className="h-5 box-border inline-flex items-center rounded border border-line bg-s2 px-1.5 text-[11px] leading-4 font-medium text-fg3">
                    {t(`conflicts.category.${app.category}`)}
                  </span>
                </div>
                <div
                  className="truncate font-mono text-[11px] leading-4 text-fg3"
                  title={uniqueImages(app)}
                >
                  {uniqueImages(app)}
                </div>
                {app.services.length > 0 && (
                  <div className="mt-1 text-xs leading-4 text-fg2">
                    {app.processes.length > 0
                      ? t('conflicts.serviceKeepsRunning')
                      : t('conflicts.serviceOnly')}
                  </div>
                )}
                {failed && (
                  <div className="mt-1 text-xs leading-4 text-warn">
                    {t('conflicts.closeFailed')}
                  </div>
                )}
              </div>
              {app.processes.length > 0 && (
                <button
                  type="button"
                  onClick={() => onCloseApp(app.id)}
                  disabled={closing}
                  className="flex shrink-0 items-center gap-1.5 h-7 rounded-md bg-acc-fill px-2.5 text-xs leading-4 font-normal text-white hover:brightness-110 disabled:cursor-wait disabled:opacity-60"
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
        <p className="m-0 text-xs leading-4 text-fg2">
          {t('conflicts.reconnectHint')}
        </p>
        <RescanButton
          label={t('conflicts.rescan')}
          scanning={scanning}
          onClick={onRescan}
        />
      </div>
      {error && (
        <p className="m-0 text-xs leading-4 text-warn">
          {t('conflicts.scanFailed', {
            error: localizeError(error, i18n.language),
          })}
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
    className="shrink-0 w-6 h-6 inline-flex items-center justify-center rounded-md text-fg3 transition-colors hover:bg-s3 hover:text-fg"
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
    className="flex shrink-0 items-center gap-1.5 h-7 rounded-md border border-line2 bg-s1 px-2.5 text-xs leading-4 font-normal text-fg transition-colors hover:bg-s2 disabled:opacity-50"
  >
    <RefreshCw className={clsx('w-3.5 h-3.5', scanning && 'animate-spin')} />
    {label}
  </button>
);
