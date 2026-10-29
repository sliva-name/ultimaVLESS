import React, { useMemo } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSplitTunnelEditor } from '@/renderer/hooks/useSplitTunnelEditor';
import { Button, TextField } from '@/renderer/components/ui';

interface SplitTunnelEditorProps {
  domains: string[];
  ips: string[];
  onChange: (next: { domains: string[]; ips: string[] }) => void;
  disabled?: boolean;
  /** Defaults to the exclusion list's wording. */
  ariaLabel?: string;
  emptyText?: string;
}

/**
 * Editor for a list of destinations (exclusions, or sites tunnelled in `sites`
 * mode). A single input accepts hosts, URLs, IPs and CIDR blocks; the entry is
 * classified on add so the user sees immediately whether it became a domain
 * rule or an address rule.
 */
export const SplitTunnelEditor: React.FC<SplitTunnelEditorProps> = ({
  domains,
  ips,
  onChange,
  disabled = false,
  ariaLabel,
  emptyText,
}) => {
  const { t } = useTranslation();
  const {
    draft,
    setDraft,
    error,
    total,
    atLimit,
    add: handleAdd,
    remove: handleRemove,
  } = useSplitTunnelEditor({ domains, ips, onChange });

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
    <div className="flex flex-col gap-3 p-4 rounded-xl bg-s1 border border-line shadow-panel">
      <div className="flex gap-2">
        <TextField
          mono
          className="flex-1"
          value={draft}
          disabled={disabled}
          placeholder={t('settings.network.splitTunnelPlaceholder')}
          aria-label={ariaLabel ?? t('settings.network.splitTunnel')}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            handleAdd();
          }}
        />
        <Button
          onClick={handleAdd}
          disabled={disabled || draft.trim().length === 0 || atLimit}
        >
          {t('settings.network.splitTunnelAdd')}
        </Button>
      </div>

      {error && <p className="m-0 text-xs leading-4 text-warn">{error}</p>}

      {total === 0 ? (
        <p className="m-0 text-xs leading-4 text-fg3">
          {emptyText ?? t('settings.network.splitTunnelEmpty')}
        </p>
      ) : (
        groups.map((group) => (
          <div key={group.kind} className="flex flex-col gap-1.5">
            {groups.length > 1 && (
              <span className="text-[11px] leading-4 font-semibold tracking-[0.06em] uppercase text-fg3">
                {group.label}
              </span>
            )}
            <ul className="m-0 p-0 list-none flex flex-wrap gap-1.5">
              {group.values.map((value) => (
                <li
                  key={value}
                  className="h-7 box-border inline-flex items-center gap-1 pl-2.5 pr-1 rounded-md bg-s2 border border-line font-mono text-xs leading-4 text-fg"
                >
                  <span className="break-all">{value}</span>
                  <button
                    type="button"
                    onClick={() => handleRemove(group.kind, value)}
                    disabled={disabled}
                    aria-label={t('settings.network.splitTunnelRemove', {
                      entry: value,
                    })}
                    className="w-5 h-5 inline-flex items-center justify-center rounded text-fg3 hover:bg-s3 hover:text-fg disabled:opacity-40"
                  >
                    <X aria-hidden strokeWidth={2.25} className="w-3 h-3" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </div>
  );
};
