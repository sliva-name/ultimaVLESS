import React, { useState, useCallback, useRef } from 'react';
import clsx from 'clsx';
import { ChevronDown } from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { VlessConfig } from '@/shared/types';
import { GroupColor } from '@/renderer/components/sidebarModel';
import { ServerItem } from './ServerItem';

interface ServerGroupProps {
  title: string;
  color: GroupColor;
  servers: VlessConfig[];
  selectedServer: VlessConfig | null;
  isConnected: boolean;
  onSelectServer: (server: VlessConfig) => void;
  collapsible?: boolean;
  defaultExpanded?: boolean;
}

const VIRTUALIZATION_THRESHOLD = 40;
const SERVER_ITEM_ESTIMATED_HEIGHT = 88;
const SERVER_ITEM_GAP = 8;

/**
 * Unified collapsible group used for subscription / orphan / manual server lists.
 * `collapsible=false` renders the header without a toggle (used for legacy orphan group).
 */
export const ServerGroup = React.memo<ServerGroupProps>(
  ({
    title,
    color,
    servers,
    selectedServer,
    isConnected,
    onSelectServer,
    collapsible = true,
    defaultExpanded = true,
  }) => {
    const [expanded, setExpanded] = useState(defaultExpanded);
    const toggle = useCallback(() => setExpanded((v) => !v), []);
    const virtualListRef = useRef<HTMLDivElement>(null);
    const shouldVirtualize = servers.length > VIRTUALIZATION_THRESHOLD;
    const virtualizer = useVirtualizer({
      count: servers.length,
      getScrollElement: () => virtualListRef.current,
      estimateSize: () => SERVER_ITEM_ESTIMATED_HEIGHT + SERVER_ITEM_GAP,
      overscan: 6,
    });

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

        {isOpen && shouldVirtualize && (
          <div
            ref={virtualListRef}
            className="overflow-y-auto pr-1"
            style={{
              maxHeight: Math.min(
                520,
                servers.length *
                  (SERVER_ITEM_ESTIMATED_HEIGHT + SERVER_ITEM_GAP),
              ),
            }}
          >
            <div
              style={{
                height: `${virtualizer.getTotalSize()}px`,
                position: 'relative',
                width: '100%',
              }}
            >
              {virtualizer.getVirtualItems().map((virtualItem) => {
                const server = servers[virtualItem.index];
                if (!server) return null;
                return (
                  <div
                    key={virtualItem.key}
                    data-index={virtualItem.index}
                    ref={virtualizer.measureElement}
                    style={{
                      left: 0,
                      paddingBottom: SERVER_ITEM_GAP,
                      position: 'absolute',
                      top: 0,
                      transform: `translateY(${virtualItem.start}px)`,
                      width: '100%',
                    }}
                  >
                    <ServerItem
                      server={server}
                      isSelected={selectedServer?.uuid === server.uuid}
                      isConnected={isConnected}
                      onSelect={onSelectServer}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {isOpen && !shouldVirtualize && (
          <div className="space-y-2">
            {servers.map((server) => (
              <ServerItem
                key={server.uuid}
                server={server}
                isSelected={selectedServer?.uuid === server.uuid}
                isConnected={isConnected}
                onSelect={onSelectServer}
              />
            ))}
          </div>
        )}
      </div>
    );
  },
);

ServerGroup.displayName = 'ServerGroup';
