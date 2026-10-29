import React, { useState, useCallback } from 'react';
import clsx from 'clsx';
import { ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { VlessConfig } from '@/shared/types';
import { isSameServerRow } from '@/shared/serverRow';
import { SERVER_LIST_VIRTUALIZE_THRESHOLD } from '@/renderer/components/sidebarModel';
import { Menu, type MenuEntry } from '@/renderer/components/ui';
import { VirtualizedServerList } from './VirtualizedServerList';
import type { RowContext, ServerRowData } from './ServerRow';

interface ServerGroupProps {
  title: string;
  servers: ServerRowData[];
  selectedServer: VlessConfig | null;
  selectionLocked?: boolean;
  onSelectServer: (server: VlessConfig) => void;
  rowContext: (server: ServerRowData) => RowContext;
  isPending: (server: VlessConfig) => boolean;
  /** The "···" menu of the group header. */
  menu: MenuEntry[];
}

/**
 * A subscription (or the manual links) in the server list: a sticky header
 * with the count and actions, then the rows sorted by latency. Large groups
 * start folded unless they hold the selected server.
 */
export const ServerGroup: React.FC<ServerGroupProps> = ({
  title,
  servers,
  selectedServer,
  selectionLocked = false,
  onSelectServer,
  rowContext,
  isPending,
  menu,
}) => {
  const { t } = useTranslation();
  const containsSelectedServer =
    selectedServer != null &&
    servers.some((server) => isSameServerRow(server, selectedServer));
  const [expanded, setExpanded] = useState(
    containsSelectedServer ||
      servers.length <= SERVER_LIST_VIRTUALIZE_THRESHOLD,
  );
  const toggle = useCallback(() => setExpanded((v) => !v), []);

  if (servers.length === 0) return null;

  return (
    <section aria-label={title} className="flex flex-col gap-0.5">
      <div className="sticky top-0 z-10 h-6 flex items-center gap-1.5 pl-2 pr-0.5 bg-s1">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={expanded}
          className="min-w-0 flex items-center gap-1.5 text-fg3 hover:text-fg2 rounded"
        >
          <span className="min-w-0 text-[11px] leading-4 font-semibold tracking-[0.06em] uppercase truncate">
            {title}
          </span>
          <span className="text-[11px] leading-4 font-semibold tabular-nums">
            {servers.length}
          </span>
          <ChevronDown
            aria-hidden
            strokeWidth={2}
            className={clsx(
              'w-3 h-3 shrink-0 transition-transform duration-200',
              !expanded && '-rotate-90',
            )}
          />
        </button>
        <span className="flex-1" />
        <Menu label={t('servers.groupActions', { name: title })} items={menu} />
      </div>

      {expanded && (
        <VirtualizedServerList
          servers={servers}
          selectedServer={selectedServer}
          selectionLocked={selectionLocked}
          onSelectServer={onSelectServer}
          rowContext={rowContext}
          isPending={isPending}
        />
      )}
    </section>
  );
};
