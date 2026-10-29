import React, { useCallback, useMemo, useState } from 'react';
import { FolderOpen, Plus, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { AppOption } from '@/shared/appRouting';
import { useAppListEditor } from '@/renderer/hooks/useAppListEditor';
import { Button, Tile } from '@/renderer/components/ui';
import { AppPicker } from './AppPicker';

interface AppListEditorProps {
  apps: string[];
  onChange: (next: string[]) => void;
  /**
   * Running programs and files picked earlier: offered in the picker, and
   * the source of exact spellings and icons.
   */
  knownApps: readonly AppOption[];
  /** Files chosen in the dialog, so the section can remember their icons. */
  onPicked: (apps: AppOption[]) => void;
  onOpenList?: () => void;
  loading?: boolean;
  ariaLabel: string;
  emptyText: string;
  disabled?: boolean;
}

/** Android names apps by package; there are no executables to pick on disk. */
const CAN_BROWSE_FILES = import.meta.env.VITE_TARGET !== 'android';

/**
 * Editor for a list of executables: one row per program with its icon on the
 * left, then a row to add more. Names can be picked from the running
 * programs, typed, or chosen on disk; either way only the file name is
 * stored, because that is what Xray's `process` rule compares.
 */
export const AppListEditor: React.FC<AppListEditorProps> = ({
  apps,
  onChange,
  knownApps,
  onPicked,
  onOpenList,
  loading = false,
  ariaLabel,
  emptyText,
  disabled = false,
}) => {
  const { t } = useTranslation();
  const [picking, setPicking] = useState(false);
  const {
    draft,
    setDraft,
    error,
    setError,
    atLimit,
    iconByName,
    addNames,
    add: handleAdd,
    pick: handlePick,
    remove: handleRemove,
  } = useAppListEditor({ apps, onChange, knownApps });

  const descriptionByName = useMemo(
    () =>
      new Map(
        knownApps
          .filter((option) => option.description)
          .map((option) => [option.name, option.description]),
      ),
    [knownApps],
  );

  const handleBrowse = useCallback(async () => {
    setError(null);
    setPicking(true);
    try {
      const picked = await window.electronAPI.pickApplications();
      if (picked.length > 0) {
        onPicked(picked);
        addNames(picked.map((option) => option.name));
      }
    } catch (err) {
      console.error('Failed to pick applications:', err);
    } finally {
      setPicking(false);
    }
  }, [addNames, onPicked, setError]);

  return (
    <div className="rounded-xl bg-s1 border border-line shadow-panel">
      <ul className="m-0 p-0 list-none divide-y divide-line">
        {apps.length === 0 ? (
          <li className="px-4 py-3 text-xs leading-4 text-fg3">{emptyText}</li>
        ) : (
          apps.map((app) => {
            const icon = iconByName.get(app);
            return (
              <li
                key={app}
                className="min-h-[52px] box-border flex items-center gap-3 px-4 py-2.5"
              >
                <Tile
                  image={icon}
                  letter={icon ? undefined : app.charAt(0).toUpperCase()}
                  tone={icon ? undefined : 'info'}
                />
                <span className="flex-1 min-w-0 flex flex-col">
                  <span className="text-[13px] leading-5 font-medium break-all">
                    {app}
                  </span>
                  {descriptionByName.get(app) && (
                    <span className="mt-0.5 text-xs leading-[18px] text-fg3 truncate">
                      {descriptionByName.get(app)}
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => handleRemove(app)}
                  disabled={disabled}
                  aria-label={t('settings.network.splitTunnelRemove', {
                    entry: app,
                  })}
                  title={t('settings.network.splitTunnelRemove', {
                    entry: app,
                  })}
                  className="w-7 h-7 shrink-0 inline-flex items-center justify-center rounded-md text-fg3 hover:bg-s3 hover:text-fg disabled:opacity-40"
                >
                  <X aria-hidden strokeWidth={1.75} className="w-4 h-4" />
                </button>
              </li>
            );
          })
        )}
      </ul>

      <div className="flex flex-col gap-2 px-4 py-2.5 border-t border-line">
        <div className="flex flex-wrap items-center gap-2">
          <Tile icon={Plus} dashed />
          <AppPicker
            value={draft}
            onValueChange={setDraft}
            options={knownApps}
            exclude={apps}
            onPick={handlePick}
            onSubmit={handleAdd}
            onOpen={onOpenList}
            loading={loading}
            disabled={disabled || atLimit}
            ariaLabel={ariaLabel}
            placeholder={t('settings.network.routingAppsPlaceholder')}
          />
          <Button
            onClick={handleAdd}
            disabled={disabled || draft.trim().length === 0 || atLimit}
          >
            {t('settings.network.splitTunnelAdd')}
          </Button>
          {CAN_BROWSE_FILES && (
            <Button
              icon={FolderOpen}
              onClick={() => void handleBrowse()}
              disabled={disabled || picking || atLimit}
            >
              {t('settings.network.routingAppsBrowse')}
            </Button>
          )}
        </div>
        {error && <p className="m-0 text-xs leading-4 text-warn">{error}</p>}
      </div>
    </div>
  );
};
