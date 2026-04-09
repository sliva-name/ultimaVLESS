/* @vitest-environment jsdom */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { Sidebar } from './Sidebar';
import { VlessConfig } from '../../shared/types';
import { vi, beforeEach } from 'vitest';
import { Subscription } from '../../shared/types';
import { createElectronApiMock, installElectronApiMock } from '../../test/electronApiMock';
import { makeServer } from '../../test/factories';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}));

describe('Sidebar', () => {
  const mockSubscriptions: Subscription[] = [];
  const mockServers: VlessConfig[] = [
    makeServer({ uuid: '1', address: 'server1.com', name: 'Server 1', security: 'reality', source: 'subscription' }),
    makeServer({ uuid: '2', address: 'server2.com', name: 'Server 2', security: 'tls', source: 'manual' }),
  ];

  beforeEach(() => {
    const electronApi = createElectronApiMock();
    electronApi.getAppVersion.mockResolvedValue('2.1.2');
    installElectronApiMock(electronApi);
  });

  it('renders subscription and manual server groups', async () => {
    render(
      <Sidebar 
        servers={mockServers}
        subscriptions={mockSubscriptions}
        selectedServer={null}
        isConnected={false}
        onSelectServer={() => {}}
        onOpenSettings={() => {}}
      />
    );

    expect(screen.getByText('Server 1')).toBeInTheDocument();
    expect(screen.getByText('Server 2')).toBeInTheDocument();
    expect(screen.getByText('settings.sources.subscriptions')).toBeInTheDocument();
    expect(screen.getByText('settings.sources.manualConfigs')).toBeInTheDocument();
    expect(await screen.findByText('v2.1.2')).toBeInTheDocument();
  });

  it('exposes selected state through aria-selected', async () => {
    render(
      <Sidebar 
        servers={mockServers}
        subscriptions={mockSubscriptions}
        selectedServer={mockServers[0]}
        isConnected={false}
        onSelectServer={() => {}}
        onOpenSettings={() => {}}
      />
    );

    expect(await screen.findByText('v2.1.2')).toBeInTheDocument();
    const server1 = screen.getByTestId('server-item-1');
    const server2 = screen.getByTestId('server-item-2');
    expect(server1).toHaveAttribute('aria-selected', 'true');
    expect(server2).toHaveAttribute('aria-selected', 'false');
  });

  it('calls onSelectServer when clicked', async () => {
    const handleSelect = vi.fn();
    render(
      <Sidebar 
        servers={mockServers}
        subscriptions={mockSubscriptions}
        selectedServer={null}
        isConnected={false}
        onSelectServer={handleSelect}
        onOpenSettings={() => {}}
      />
    );

    expect(await screen.findByText('v2.1.2')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('server-item-1'));
    expect(handleSelect).toHaveBeenCalledWith(mockServers[0]);
  });

  it('does not allow selecting another server while connected', async () => {
    const handleSelect = vi.fn();
    render(
      <Sidebar 
        servers={mockServers}
        subscriptions={mockSubscriptions}
        selectedServer={mockServers[0]}
        isConnected={true}
        onSelectServer={handleSelect}
        onOpenSettings={() => {}}
      />
    );

    expect(await screen.findByText('v2.1.2')).toBeInTheDocument();
    const otherServer = screen.getByTestId('server-item-2');
    fireEvent.click(otherServer);

    expect(otherServer).toHaveAttribute('aria-disabled', 'true');
    expect(handleSelect).not.toHaveBeenCalled();
  });

  it('shows placeholder when ping is missing', async () => {
    render(
      <Sidebar
        servers={mockServers}
        subscriptions={mockSubscriptions}
        selectedServer={null}
        isConnected={false}
        onSelectServer={() => {}}
        onOpenSettings={() => {}}
      />
    );

    expect(await screen.findByText('v2.1.2')).toBeInTheDocument();
    expect(screen.getAllByText('—')).toHaveLength(2);
  });

  it('disables ping refresh while connected', async () => {
    render(
      <Sidebar
        servers={mockServers}
        subscriptions={mockSubscriptions}
        selectedServer={mockServers[0]}
        isConnected={true}
        onSelectServer={() => {}}
        onOpenSettings={() => {}}
        onPingAll={vi.fn()}
      />
    );

    expect(await screen.findByText('v2.1.2')).toBeInTheDocument();
    expect(screen.getByTitle('sidebar.pingAll')).toBeDisabled();
  });
});

