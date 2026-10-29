import React, {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { VlessConfig } from '@/shared/types';
import { isSameServerRow } from '@/shared/serverRow';
import {
  SERVER_ITEM_ESTIMATED_HEIGHT_PX,
  SERVER_LIST_VIRTUALIZE_THRESHOLD,
} from '@/renderer/components/sidebarModel';
import { ServerRow, type RowContext, type ServerRowData } from './ServerRow';

interface VirtualizedServerListProps {
  servers: ServerRowData[];
  selectedServer: VlessConfig | null;
  selectionLocked?: boolean;
  onSelectServer: (server: VlessConfig) => void;
  rowContext: (server: ServerRowData) => RowContext;
  isPending: (server: VlessConfig) => boolean;
}

const OVERSCAN_ROWS = 4;
/** Fallback until ResizeObserver reports a real viewport height. */
const FALLBACK_VIEWPORT_HEIGHT_PX = 320;

export const VirtualizedServerList: React.FC<VirtualizedServerListProps> = ({
  servers,
  selectedServer,
  selectionLocked = false,
  onSelectServer,
  rowContext,
  isPending,
}) => {
  const shouldVirtualize = servers.length > SERVER_LIST_VIRTUALIZE_THRESHOLD;

  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  const onScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(event.currentTarget.scrollTop);
  }, []);

  const scheduleViewportMeasure = useCallback((node: HTMLDivElement) => {
    const measure = () => {
      const height = node.clientHeight;
      if (height > 0) {
        setViewportHeight(height);
      }
    };

    requestAnimationFrame(measure);

    if (typeof ResizeObserver === 'undefined') {
      return undefined;
    }

    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (!shouldVirtualize) {
      return;
    }
    const node = scrollRef.current;
    if (!node) {
      return;
    }
    return scheduleViewportMeasure(node);
  }, [shouldVirtualize, servers.length, scheduleViewportMeasure]);

  const selectedIndex = useMemo(() => {
    if (!selectedServer) {
      return -1;
    }
    const rowIndex = servers.findIndex((server) =>
      isSameServerRow(server, selectedServer),
    );
    if (rowIndex >= 0) {
      return rowIndex;
    }
    return servers.findIndex((server) => server.uuid === selectedServer.uuid);
  }, [selectedServer, servers]);

  useLayoutEffect(() => {
    if (!shouldVirtualize || selectedIndex < 0) {
      return;
    }
    const index = selectedIndex;
    const node = scrollRef.current;
    if (!node) {
      return;
    }

    const rowHeight = SERVER_ITEM_ESTIMATED_HEIGHT_PX;
    const targetTop = index * rowHeight;
    const viewHeight =
      viewportHeight > 0 ? viewportHeight : FALLBACK_VIEWPORT_HEIGHT_PX;
    const maxScroll = Math.max(0, servers.length * rowHeight - viewHeight);
    const nextScroll = Math.min(
      maxScroll,
      Math.max(0, targetTop - Math.floor(viewHeight / 3)),
    );

    if (Math.abs(node.scrollTop - nextScroll) <= 2) {
      return;
    }

    node.scrollTop = nextScroll;
    const frame = requestAnimationFrame(() => {
      setScrollTop(node.scrollTop);
    });
    return () => cancelAnimationFrame(frame);
  }, [shouldVirtualize, selectedIndex, servers.length, viewportHeight]);

  const effectiveViewportHeight =
    viewportHeight > 0 ? viewportHeight : FALLBACK_VIEWPORT_HEIGHT_PX;

  const { startIndex, endIndex, topSpacer, bottomSpacer } = useMemo(() => {
    if (!shouldVirtualize) {
      return {
        startIndex: 0,
        endIndex: servers.length,
        topSpacer: 0,
        bottomSpacer: 0,
      };
    }

    const rowHeight = SERVER_ITEM_ESTIMATED_HEIGHT_PX;
    const visibleRows =
      Math.ceil(effectiveViewportHeight / rowHeight) + OVERSCAN_ROWS * 2;
    // Clamp against stale scrollTop after the list shrinks so the visible
    // window never ends up entirely past the end of the list.
    const firstVisible = Math.min(
      Math.floor(scrollTop / rowHeight),
      Math.max(0, servers.length - 1),
    );
    const start = Math.max(0, firstVisible - OVERSCAN_ROWS);
    const end = Math.min(servers.length, start + Math.max(visibleRows, 1));

    return {
      startIndex: start,
      endIndex: end,
      topSpacer: start * rowHeight,
      bottomSpacer: (servers.length - end) * rowHeight,
    };
  }, [scrollTop, effectiveViewportHeight, servers.length, shouldVirtualize]);

  const visibleServers = useMemo(
    () => servers.slice(startIndex, endIndex),
    [servers, startIndex, endIndex],
  );

  const renderRow = (server: ServerRowData) => (
    <ServerRow
      server={server}
      isSelected={
        selectedServer != null && isSameServerRow(selectedServer, server)
      }
      selectionLocked={selectionLocked}
      context={rowContext(server)}
      pending={isPending(server)}
      onSelect={onSelectServer}
    />
  );

  if (!shouldVirtualize) {
    return (
      <div className="flex flex-col gap-0.5">
        {servers.map((server, index) => (
          <React.Fragment key={`${server.uuid}:${index}`}>
            {renderRow(server)}
          </React.Fragment>
        ))}
      </div>
    );
  }

  const totalHeight = servers.length * SERVER_ITEM_ESTIMATED_HEIGHT_PX;

  return (
    <div
      ref={scrollRef}
      className="min-h-[12rem] max-h-[min(52vh,28rem)] overflow-y-auto"
      onScroll={onScroll}
      data-testid="virtualized-server-list"
    >
      <div style={{ height: totalHeight, position: 'relative' }}>
        <div style={{ height: topSpacer }} aria-hidden />
        {/* No gap utilities here: each row carries its own fixed height with
            a padding-bottom gap so windowing math matches the rendered DOM. */}
        {visibleServers.map((server, offset) => (
          <div
            key={`${server.uuid}:${startIndex + offset}`}
            style={{ height: SERVER_ITEM_ESTIMATED_HEIGHT_PX }}
            className="pb-0.5"
          >
            {renderRow(server)}
          </div>
        ))}
        <div style={{ height: bottomSpacer }} aria-hidden />
      </div>
    </div>
  );
};
