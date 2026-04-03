import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { Sidebar } from './Sidebar';
import { VlessConfig } from '../../shared/types';
import { vi, beforeEach } from 'vitest';
import { createElectronApiMock, installElectronApiMock } from '../../test/electronApiMock';
import { makeServer } from '../../test/factories';

describe('Sidebar', () => {
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
        selectedServer={null}
        isConnected={false}
        onSelectServer={() => {}}
        onOpenSettings={() => {}}
      />
    );

    expect(screen.getByText('Server 1')).toBeInTheDocument();
    expect(screen.getByText('Server 2')).toBeInTheDocument();
    expect(screen.getByText('Subscription')).toBeInTheDocument();
    expect(screen.getByText('Manual')).toBeInTheDocument();
    expect(await screen.findByText('v2.1.2')).toBeInTheDocument();
  });

  it('exposes selected state through aria-selected', () => {
    render(
      <Sidebar 
        servers={mockServers}
        selectedServer={mockServers[0]}
        isConnected={false}
        onSelectServer={() => {}}
        onOpenSettings={() => {}}
      />
    );

    const server1 = screen.getByTestId('server-item-1');
    const server2 = screen.getByTestId('server-item-2');
    expect(server1).toHaveAttribute('aria-selected', 'true');
    expect(server2).toHaveAttribute('aria-selected', 'false');
  });

  it('calls onSelectServer when clicked', () => {
    const handleSelect = vi.fn();
    render(
      <Sidebar 
        servers={mockServers}
        selectedServer={null}
        isConnected={false}
        onSelectServer={handleSelect}
        onOpenSettings={() => {}}
      />
    );

    fireEvent.click(screen.getByTestId('server-item-1'));
    expect(handleSelect).toHaveBeenCalledWith(mockServers[0]);
  });

  it('does not allow selecting another server while connected', () => {
    const handleSelect = vi.fn();
    render(
      <Sidebar 
        servers={mockServers}
        selectedServer={mockServers[0]}
        isConnected={true}
        onSelectServer={handleSelect}
        onOpenSettings={() => {}}
      />
    );

    const otherServer = screen.getByTestId('server-item-2');
    fireEvent.click(otherServer);

    expect(otherServer).toHaveAttribute('aria-disabled', 'true');
    expect(handleSelect).not.toHaveBeenCalled();
  });

  it('shows placeholder when ping is missing', () => {
    render(
      <Sidebar
        servers={mockServers}
        selectedServer={null}
        isConnected={false}
        onSelectServer={() => {}}
        onOpenSettings={() => {}}
      />
    );

    expect(screen.getAllByText('—')).toHaveLength(2);
  });

  it('disables ping refresh while connected', () => {
    render(
      <Sidebar
        servers={mockServers}
        selectedServer={mockServers[0]}
        isConnected={true}
        onSelectServer={() => {}}
        onOpenSettings={() => {}}
        onPingAll={vi.fn()}
      />
    );

    expect(screen.getByTitle('Disconnect to refresh ping')).toBeDisabled();
  });
});

