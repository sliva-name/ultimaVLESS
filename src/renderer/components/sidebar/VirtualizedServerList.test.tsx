/* @vitest-environment jsdom */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VirtualizedServerList } from './VirtualizedServerList';
import { SERVER_LIST_VIRTUALIZE_THRESHOLD } from '@/renderer/components/sidebarModel';
import type { VlessConfig } from '@/shared/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/renderer/components/CountryFlag', () => ({
  CountryFlag: () => <span data-testid="flag" />,
}));

beforeEach(() => {
  global.ResizeObserver = class {
    observe = vi.fn();
    disconnect = vi.fn();
    unobserve = vi.fn();
    constructor(_callback: ResizeObserverCallback) {}
  } as unknown as typeof ResizeObserver;
});

function makeServers(count: number): VlessConfig[] {
  return Array.from({ length: count }, (_, index) => ({
    uuid: `server-${index}`,
    address: `host-${index}.example.com`,
    port: 443,
    name: `Server ${index}`,
    source: 'subscription' as const,
    subscriptionId: 'sub-1',
  }));
}

describe('VirtualizedServerList', () => {
  it('renders a scrollable list for large groups', () => {
    const servers = makeServers(SERVER_LIST_VIRTUALIZE_THRESHOLD + 5);
    render(
      <VirtualizedServerList
        servers={servers}
        selectedServer={null}
        isConnected={false}
        onSelectServer={() => {}}
      />,
    );

    const list = screen.getByTestId('virtualized-server-list');
    expect(list).toBeInTheDocument();
    expect(list.className).toMatch(/overflow-y-auto/);
    expect(screen.getByTestId(`server-item-${servers[0].uuid}`)).toBeInTheDocument();
  });

  it('renders all items without virtualization for small groups', () => {
    const servers = makeServers(3);
    render(
      <VirtualizedServerList
        servers={servers}
        selectedServer={null}
        isConnected={false}
        onSelectServer={() => {}}
      />,
    );

    expect(screen.queryByTestId('virtualized-server-list')).not.toBeInTheDocument();
    servers.forEach((server) => {
      expect(screen.getByTestId(`server-item-${server.uuid}`)).toBeInTheDocument();
    });
  });

  it('updates visible window on scroll', () => {
    const servers = makeServers(60);
    render(
      <VirtualizedServerList
        servers={servers}
        selectedServer={null}
        isConnected={false}
        onSelectServer={() => {}}
      />,
    );

    const list = screen.getByTestId('virtualized-server-list');
    Object.defineProperty(list, 'clientHeight', {
      configurable: true,
      value: 320,
    });
    fireEvent.scroll(list, { target: { scrollTop: 2000 } });

    expect(screen.queryByTestId('server-item-server-0')).not.toBeInTheDocument();
    expect(screen.getByTestId('server-item-server-25')).toBeInTheDocument();
  });
});
