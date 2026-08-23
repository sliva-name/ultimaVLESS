import React, { useState, useCallback } from 'react';
import clsx from 'clsx';
import { ChevronDown } from 'lucide-react';
import { VlessConfig } from '@/shared/types';
import { isSameServerRow } from '@/shared/serverRow';
import {
  GroupColor,
  SERVER_LIST_VIRTUALIZE_THRESHOLD,
} from '@/renderer/components/sidebarModel';
import { VirtualizedServerList } from './VirtualizedServerList';

interface ServerGroupProps {
  title: string;
  color: GroupColor;
  servers: VlessConfig[];
  selectedServer: VlessConfig | null;
  selectionLocked?: boolean;
  onSelectServer: (server: VlessConfig) => void;
  collapsible?: boolean;
  defaultExpanded?: boolean;
}

/**
 * Unified collapsible group used for subscription / orphan / manual server lists.
 * `collapsible=false` renders the header without a toggle (used for legacy orphan group).
 */
export const ServerGroup: React.FC<ServerGroupProps> = ({
  title,
  color,
  servers,
  selectedServer,
  selectionLocked = false,
  onSelectServer,
  collapsible = true,
  defaultExpanded,
}) => {
  // Always start expanded when the group holds the selected server, even if
  // it is large enough to be collapsed by default.
  const containsSelectedServer =
    selectedServer != null &&
    servers.some((server) => isSameServerRow(server, selectedServer));
  const initialExpanded =
    defaultExpanded ??
    (containsSelectedServer ||
      servers.length <= SERVER_LIST_VIRTUALIZE_THRESHOLD);
  const [expanded, setExpanded] = useState(initialExpanded);
  const toggle = useCallback(() => setExpanded((v) => !v), []);

  if (servers.length === 0) return null;

  const isOpen = collapsible ? expanded : true;

  const headerContent = (
    <div className="flex items-center gap-2 min-w-0">
      <span
        className={clsx(
          'w-1.5 h-1.5 shrink-0 rounded-full shadow-sm',
          color.dot,
        )}
      />
      <span
        className="text-[10px] font-semibold text-gray-300 uppercase tracking-wider truncate min-w-0 flex-1"
        title={title}
      >
        {title}
      </span>
      <span
        className={clsx(
          'text-[10px] px-1.5 py-0.5 rounded-md border shrink-0',
          color.badge,
        )}
      >
        {servers.length}
      </span>
    </div>
  );

  return (
    <div
      className={clsx(
        'rounded-xl border p-2',
        color.border,
        'bg-linear-to-br',
        color.bg,
        'to-transparent',
      )}
    >
      {collapsible ? (
        <button
          type="button"
          onClick={toggle}
          aria-expanded={expanded}
          className="w-full px-2 py-1.5 mb-1 flex items-center justify-between rounded-lg hover:bg-white/5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          {headerContent}
          <ChevronDown
            className={clsx(
              'w-3.5 h-3.5 shrink-0 text-gray-400 transition-transform',
              expanded && 'rotate-180',
            )}
          />
        </button>
      ) : (
        <div className="px-2 py-1.5 mb-1 flex items-center gap-2">
          {headerContent}
        </div>
      )}

      {isOpen && (
        <VirtualizedServerList
          servers={servers}
          selectedServer={selectedServer}
          selectionLocked={selectionLocked}
          onSelectServer={onSelectServer}
        />
      )}
    </div>
  );
};
