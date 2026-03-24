import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { Sidebar } from './Sidebar';
import { VlessConfig } from '../../shared/types';
import { vi, beforeEach } from 'vitest';

describe('Sidebar', () => {
  const mockServers: VlessConfig[] = [
    {
      uuid: '1',
      address: 'server1.com',
      port: 443,
      name: 'Server 1',
      security: 'reality'
    },
    {
      uuid: '2',
      address: 'server2.com',
      port: 443,
      name: 'Server 2',
      security: 'tls'
    }
  ];

  beforeEach(() => {
    (window as unknown as { electronAPI: { getAppVersion: () => Promise<string> } }).electronAPI = {
      getAppVersion: vi.fn().mockResolvedValue('2.1.2'),
    };
  });

  it('renders server list', () => {
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
  });

  it('highlights selected server', () => {
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
    expect(server1.className).toContain('from-primary/20');
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
});

