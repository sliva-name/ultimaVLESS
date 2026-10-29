import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  MAX_SPLIT_TUNNEL_ENTRIES,
  classifySplitTunnelEntry,
} from '@/shared/splitTunneling';

export interface SplitTunnelLists {
  domains: string[];
  ips: string[];
}

interface UseSplitTunnelEditorParams extends SplitTunnelLists {
  onChange: (next: SplitTunnelLists) => void;
}

/**
 * Draft and validation of a destination list (exclusions, or sites tunnelled
 * in `sites` mode). One input accepts hosts, URLs, IPs and CIDR blocks; each
 * entry is classified on add. Shared by the desktop and Android editors.
 */
export function useSplitTunnelEditor({
  domains,
  ips,
  onChange,
}: UseSplitTunnelEditorParams) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const total = domains.length + ips.length;
  const atLimit = total >= MAX_SPLIT_TUNNEL_ENTRIES;

  const add = useCallback(() => {
    setError(null);
    // Support pasting a whole list at once.
    const candidates = draft
      .split(/[\s,;]+/)
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    if (candidates.length === 0) return;

    const nextDomains = [...domains];
    const nextIps = [...ips];
    const rejected: string[] = [];
    let added = 0;

    for (const candidate of candidates) {
      if (nextDomains.length + nextIps.length >= MAX_SPLIT_TUNNEL_ENTRIES) {
        setError(t('settings.network.splitTunnelLimit'));
        break;
      }
      const entry = classifySplitTunnelEntry(candidate);
      if (!entry) {
        rejected.push(candidate);
        continue;
      }
      const target = entry.kind === 'domain' ? nextDomains : nextIps;
      if (target.includes(entry.value)) continue;
      target.push(entry.value);
      added += 1;
    }

    if (rejected.length > 0) {
      setError(
        t('settings.network.splitTunnelInvalid', {
          entries: rejected.slice(0, 3).join(', '),
        }),
      );
    }
    if (added === 0) return;
    setDraft(rejected.length > 0 ? rejected.join(' ') : '');
    onChange({ domains: nextDomains, ips: nextIps });
  }, [domains, draft, ips, onChange, t]);

  const remove = useCallback(
    (kind: 'domain' | 'ip', value: string) => {
      setError(null);
      onChange({
        domains:
          kind === 'domain' ? domains.filter((d) => d !== value) : domains,
        ips: kind === 'ip' ? ips.filter((ip) => ip !== value) : ips,
      });
    },
    [domains, ips, onChange],
  );

  return { draft, setDraft, error, total, atLimit, add, remove };
}
