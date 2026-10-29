import React, { useCallback } from 'react';
import clsx from 'clsx';
import type { VlessConfig } from '@/shared/types';
import type { SafeServerConfig } from '@/shared/serverView';
import { PingBadge, ServerFlag } from './serverParts';

export type ServerRowData = VlessConfig &
  Pick<SafeServerConfig, 'outboundCompatible'>;

/** The context line under the name and its color. */
export interface RowContext {
  text: string;
  tone: 'fg3' | 'ok' | 'warn' | 'bad';
}

interface ServerRowProps {
  server: ServerRowData;
  isSelected: boolean;
  /** While a session runs: every row is locked, the others dimmed. */
  selectionLocked?: boolean;
  context: RowContext;
  /** Waiting for this server's answer in the running check. */
  pending?: boolean;
  onSelect: (server: VlessConfig) => void;
}

const TONE_CLASS: Record<RowContext['tone'], string> = {
  fg3: 'text-fg3',
  ok: 'text-ok',
  warn: 'text-warn',
  bad: 'text-bad',
};

/** 48 px row: round flag, name, one line of context, latency badge. */
export const ServerRow = React.memo<ServerRowProps>(
  ({
    server,
    isSelected,
    selectionLocked = false,
    context,
    pending = false,
    onSelect,
  }) => {
    const handleSelect = useCallback(() => {
      if (!selectionLocked) onSelect(server);
    }, [selectionLocked, onSelect, server]);

    return (
      <button
        type="button"
        onClick={handleSelect}
        aria-pressed={isSelected}
        aria-disabled={selectionLocked}
        title={`${server.address}:${server.port}`}
        data-testid={`server-item-${server.uuid}`}
        data-server-uuid={server.uuid}
        data-server-row
        className={clsx(
          'w-full h-12 flex items-center gap-2.5 px-2.5 rounded-lg text-left',
          'transition-[background-color,opacity] duration-150',
          isSelected
            ? 'bg-acc-soft shadow-[inset_0_0_0_1px_var(--color-acc-line)]'
            : !selectionLocked && 'hover:bg-s2',
          selectionLocked
            ? clsx('cursor-default', !isSelected && 'opacity-50')
            : 'cursor-pointer',
        )}
      >
        <ServerFlag server={server} size={20} />
        <span className="flex-1 min-w-0 flex flex-col">
          <span className="text-[13px] leading-[18px] font-medium truncate">
            {server.name}
          </span>
          <span
            className={clsx(
              'text-xs leading-4 truncate',
              TONE_CLASS[context.tone],
            )}
            data-testid={
              server.outboundCompatible === false
                ? `server-incompatible-${server.uuid}`
                : undefined
            }
          >
            {context.text}
          </span>
        </span>
        <PingBadge server={server} pending={pending} />
      </button>
    );
  },
);

ServerRow.displayName = 'ServerRow';
