import React, { useCallback, useId, useState } from 'react';
import { FolderOpen, Plus, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  MAX_APP_ROUTING_ENTRIES,
  classifyAppEntry,
  matchKnownAppName,
} from '@/shared/appRouting';

interface AppListEditorProps {
  apps: string[];
  onChange: (next: string[]) => void;
  /** Running executables; completes typed names with their exact spelling. */
  suggestions: readonly string[];
  ariaLabel: string;
  emptyText: string;
  disabled?: boolean;
}

/**
 * Editor for a list of executables. Names can be typed (with suggestions from
 * running processes) or picked from disk; either way only the file name is
 * stored, because that is what Xray's `process` rule compares.
 */
export const AppListEditor: React.FC<AppListEditorProps> = ({
  apps,
  onChange,
  suggestions,
  ariaLabel,
  emptyText,
  disabled = false,
}) => {
  const { t } = useTranslation();
  const listId = useId();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  const atLimit = apps.length >= MAX_APP_ROUTING_ENTRIES;

  /** Adds names to the list; returns the inputs that were not names. */
  const addNames = useCallback(
    (candidates: string[]): string[] => {
      const next = [...apps];
      const rejected: string[] = [];
      let full = false;
      for (const candidate of candidates) {
        if (next.length >= MAX_APP_ROUTING_ENTRIES) {
          full = true;
          break;
        }
        const entry = classifyAppEntry(candidate);
        if (!entry) {
          rejected.push(candidate);
          continue;
        }
        const name = matchKnownAppName(entry, suggestions);
        if (!next.includes(name)) next.push(name);
      }
      if (full) {
        setError(t('settings.network.splitTunnelLimit'));
      } else if (rejected.length > 0) {
        setError(
          t('settings.network.routingAppsInvalid', {
            entries: rejected.slice(0, 3).join(', '),
          }),
        );
      }
      if (next.length !== apps.length) onChange(next);
      return rejected;
    },
    [apps, onChange, suggestions, t],
  );

  const handleAdd = useCallback(() => {
    setError(null);
    // Names may contain spaces, so only commas, semicolons and line breaks
    // separate a pasted list.
    const candidates = draft
      .split(/[,;\r\n]+/)
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    if (candidates.length === 0) return;
    const rejected = addNames(candidates);
    setDraft(rejected.join(', '));
  }, [addNames, draft]);

  const handleBrowse = useCallback(async () => {
    setError(null);
    setPicking(true);
    try {
      const picked = await window.electronAPI.pickApplications();
      if (picked.length > 0) addNames(picked);
    } catch (err) {
      console.error('Failed to pick applications:', err);
    } finally {
      setPicking(false);
    }
  }, [addNames]);

  const handleRemove = useCallback(
    (value: string) => {
      setError(null);
      onChange(apps.filter((app) => app !== value));
    },
    [apps, onChange],
  );

  const buttonClass =
    'flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-gray-200 border border-gray-700/50 hover:border-gray-600/70 hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed transition-colors';

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={draft}
          disabled={disabled}
          list={listId}
          placeholder={t('settings.network.routingAppsPlaceholder')}
          aria-label={ariaLabel}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            handleAdd();
          }}
          className="flex-1 min-w-40 bg-black/40 border border-gray-600/50 rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-600 focus:border-primary/60 focus:ring-1 focus:ring-primary/20 outline-none font-mono"
        />
        <datalist id={listId}>
          {suggestions.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
        <button
          type="button"
          onClick={handleAdd}
          disabled={disabled || draft.trim().length === 0 || atLimit}
          className={buttonClass}
        >
          <Plus className="w-4 h-4" />
          {t('settings.network.splitTunnelAdd')}
        </button>
        <button
          type="button"
          onClick={() => void handleBrowse()}
          disabled={disabled || picking || atLimit}
          className={buttonClass}
        >
          <FolderOpen className="w-4 h-4" />
          {t('settings.network.routingAppsBrowse')}
        </button>
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
              className="flex items-center gap-1.5 rounded-lg border border-gray-700/50 bg-gray-800/40 pl-2.5 pr-1.5 py-1"
            >
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
