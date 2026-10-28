import React, { useCallback, useState } from 'react';
import { FolderOpen, Plus, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { AppOption } from '@/shared/appRouting';
import { useAppListEditor } from '@/renderer/hooks/useAppListEditor';
import { AppIcon, AppPicker } from './AppPicker';

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
 * Editor for a list of executables. Names can be picked from the running
 * programs, typed, or chosen on disk; either way only the file name is stored,
 * because that is what Xray's `process` rule compares.
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

  const buttonClass =
    'flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-gray-200 border border-gray-700/50 hover:border-gray-600/70 hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed transition-colors';

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
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
        <button
          type="button"
          onClick={handleAdd}
          disabled={disabled || draft.trim().length === 0 || atLimit}
          className={buttonClass}
        >
          <Plus className="w-4 h-4" />
          {t('settings.network.splitTunnelAdd')}
        </button>
        {CAN_BROWSE_FILES && (
          <button
            type="button"
            onClick={() => void handleBrowse()}
            disabled={disabled || picking || atLimit}
            className={buttonClass}
          >
            <FolderOpen className="w-4 h-4" />
            {t('settings.network.routingAppsBrowse')}
          </button>
        )}
      </div>

      {error && (
        <p className="text-xs text-orange-400 leading-relaxed">{error}</p>
      )}

      {apps.length === 0 ? (
        <p className="text-xs text-gray-500 leading-relaxed">{emptyText}</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {apps.map((app) => (
            <li
              key={app}
              className="flex items-center gap-1.5 rounded-lg border border-gray-700/50 bg-gray-800/40 pl-2 pr-1.5 py-1"
            >
              <AppIcon icon={iconByName.get(app)} className="h-4 w-4" />
              <span className="text-xs text-gray-200 font-mono break-all">
                {app}
              </span>
              <button
                type="button"
                onClick={() => handleRemove(app)}
                disabled={disabled}
                aria-label={t('settings.network.splitTunnelRemove', {
                  entry: app,
                })}
                className="p-0.5 rounded text-gray-500 hover:text-orange-300 hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
