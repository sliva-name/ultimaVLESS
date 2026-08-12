import React, { useCallback, useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  MAX_SPLIT_TUNNEL_ENTRIES,
  classifySplitTunnelEntry,
} from '@/shared/splitTunneling';

interface SplitTunnelEditorProps {
  domains: string[];
  ips: string[];
  onChange: (next: { domains: string[]; ips: string[] }) => void;
  disabled?: boolean;
}

/**
 * Editor for the destinations that must skip the tunnel. A single input accepts
 * hosts, URLs, IPs and CIDR blocks; the entry is classified on add so the user
 * sees immediately whether it became a domain rule or an address rule.
 */
export const SplitTunnelEditor: React.FC<SplitTunnelEditorProps> = ({
  domains,
  ips,
  onChange,
  disabled = false,
}) => {
  const { t } = useTranslation();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const total = domains.length + ips.length;
  const atLimit = total >= MAX_SPLIT_TUNNEL_ENTRIES;

  const handleAdd = useCallback(() => {
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

  const handleRemove = useCallback(
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

  const groups = useMemo(
    () =>
      [
        {
          kind: 'domain' as const,
          label: t('settings.network.splitTunnelDomains'),
          values: domains,
        },
        {
          kind: 'ip' as const,
          label: t('settings.network.splitTunnelIps'),
          values: ips,
        },
      ].filter((group) => group.values.length > 0),
    [domains, ips, t],
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={draft}
          disabled={disabled}
          placeholder={t('settings.network.splitTunnelPlaceholder')}
          aria-label={t('settings.network.splitTunnel')}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            handleAdd();
          }}
          className="flex-1 min-w-0 bg-black/40 border border-gray-600/50 rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-600 focus:border-primary/60 focus:ring-1 focus:ring-primary/20 outline-none font-mono"
        />
        <button
          type="button"
          onClick={handleAdd}
          disabled={disabled || draft.trim().length === 0 || atLimit}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-gray-200 border border-gray-700/50 hover:border-gray-600/70 hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <Plus className="w-4 h-4" />
          {t('settings.network.splitTunnelAdd')}
        </button>
      </div>

      {error && <p className="text-xs text-orange-400 leading-relaxed">{error}</p>}

      {total === 0 ? (
        <p className="text-xs text-gray-500 leading-relaxed">
          {t('settings.network.splitTunnelEmpty')}
        </p>
      ) : (
        <div className="space-y-3">
          {groups.map((group) => (
            <div key={group.kind} className="space-y-1.5">
              <div className="text-xs uppercase tracking-wide text-gray-500">
                {group.label}
              </div>
              <ul className="flex flex-wrap gap-1.5">
                {group.values.map((value) => (
                  <li
                    key={value}
                    className="flex items-center gap-1.5 rounded-lg border border-gray-700/50 bg-gray-800/40 pl-2.5 pr-1.5 py-1"
                  >
                    <span className="text-xs text-gray-200 font-mono break-all">
                      {value}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleRemove(group.kind, value)}
                      disabled={disabled}
                      aria-label={t('settings.network.splitTunnelRemove', {
                        entry: value,
                      })}
                      className="p-0.5 rounded text-gray-500 hover:text-orange-300 hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
