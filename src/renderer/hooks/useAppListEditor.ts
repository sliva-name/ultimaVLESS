import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  MAX_APP_ROUTING_ENTRIES,
  classifyAppEntry,
  matchKnownAppName,
  type AppOption,
} from '@/shared/appRouting';

interface UseAppListEditorParams {
  apps: string[];
  onChange: (next: string[]) => void;
  /** Source of exact spellings and icons. */
  knownApps: readonly AppOption[];
}

/**
 * Draft and validation of a per-app routing list. Only the name is stored,
 * spelled as the system reports it, because that is what Xray's `process`
 * rule (or Android's VpnService package filter) compares. Shared by the
 * desktop and Android editors.
 */
export function useAppListEditor({
  apps,
  onChange,
  knownApps,
}: UseAppListEditorParams) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const atLimit = apps.length >= MAX_APP_ROUTING_ENTRIES;
  const knownNames = useMemo(
    () => knownApps.map((option) => option.name),
    [knownApps],
  );
  const iconByName = useMemo(
    () => new Map(knownApps.map((option) => [option.name, option.icon])),
    [knownApps],
  );

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
        const name = matchKnownAppName(entry, knownNames);
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
    [apps, knownNames, onChange, t],
  );

  const add = useCallback(() => {
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

  const pick = useCallback(
    (name: string) => {
      setError(null);
      addNames([name]);
      setDraft('');
    },
    [addNames],
  );

  const remove = useCallback(
    (value: string) => {
      setError(null);
      onChange(apps.filter((app) => app !== value));
    },
    [apps, onChange],
  );

  return {
    draft,
    setDraft,
    error,
    setError,
    atLimit,
    iconByName,
    addNames,
    add,
    pick,
    remove,
  };
}
