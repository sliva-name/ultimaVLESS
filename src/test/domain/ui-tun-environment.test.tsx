/* @vitest-environment jsdom */
import React from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';
import i18n from '@/renderer/i18n';
import { AppSnapshotProvider } from '@/renderer/hooks/useAppSnapshot';
import { SettingsNetworkTab } from '@/renderer/components/settings/SettingsNetworkTab';
import { TunConflictNotice } from '@/renderer/components/TunConflictNotice';
import type { NetworkAdapterView, TunConflictCheck } from '@/shared/ipc';
import { DEFAULT_PERFORMANCE_SETTINGS } from '@/shared/types';
import {
  createElectronApiMock,
  installElectronApiMock,
} from '@/test/electronApiMock';

const ADAPTERS: NetworkAdapterView[] = [
  {
    name: 'Беспроводная сеть',
    description: 'Intel(R) Wi-Fi 6E AX210 160MHz',
    ipv4: ['192.168.0.124'],
    gateway: '192.168.0.1',
    kind: 'physical',
    isAutomaticChoice: true,
  },
  {
    name: 'Ethernet 2',
    description: 'Realtek USB GbE Family Controller',
    ipv4: ['10.20.0.15'],
    gateway: '10.20.0.1',
    kind: 'physical',
    isAutomaticChoice: false,
  },
  {
    name: 'VirtualBox Host-Only Network',
    description: 'VirtualBox Host-Only Ethernet Adapter',
    ipv4: ['192.168.56.1'],
    gateway: null,
    kind: 'virtual',
    isAutomaticChoice: false,
  },
];

function renderNetworkTab(tunOutboundInterface = '') {
  const electronApi = createElectronApiMock();
  electronApi.getPerformanceSettings.mockResolvedValue({
    ...DEFAULT_PERFORMANCE_SETTINGS,
    tunOutboundInterface,
  });
  electronApi.listNetworkAdapters.mockResolvedValue({
    supported: true,
    adapters: ADAPTERS,
  });
  installElectronApiMock(electronApi);
  render(
    <AppSnapshotProvider>
      <SettingsNetworkTab isOpen isConnected={false} isConnectionBusy={false} />
    </AppSnapshotProvider>,
  );
  return electronApi;
}

beforeAll(async () => {
  await i18n.changeLanguage('ru');
});

describe('TUN adapter picker', () => {
  it('shows what automatic picks and saves a manual choice', async () => {
    const electronApi = renderNetworkTab();

    const trigger = await screen.findByRole('button', {
      name: 'Сетевой адаптер для TUN',
    });
    await waitFor(() =>
      expect(trigger).toHaveTextContent('Сейчас: Беспроводная сеть'),
    );
    expect(trigger).toHaveTextContent('Автоматически');

    fireEvent.click(trigger);
    const listbox = await screen.findByRole('listbox', {
      name: 'Сетевой адаптер для TUN',
    });
    const options = within(listbox).getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual([
      'АвтоматическиСейчас: Беспроводная сеть',
      'Беспроводная сетьIntel(R) Wi-Fi 6E AX210 160MHz · 192.168.0.124 · шлюз 192.168.0.1',
      'Ethernet 2Realtek USB GbE Family Controller · 10.20.0.15 · шлюз 10.20.0.1',
      'VirtualBox Host-Only NetworkVirtualBox Host-Only Ethernet Adapter · 192.168.56.1 · нет шлюза · виртуальный',
    ]);

    fireEvent.click(options[2]);
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() =>
      expect(electronApi.setPerformanceSettings).toHaveBeenCalledWith(
        expect.objectContaining({ tunOutboundInterface: 'Ethernet 2' }),
      ),
    );
  });

  it('keeps a saved adapter that is gone and warns about it', async () => {
    renderNetworkTab('Ethernet 5');

    expect(
      await screen.findByText(
        'Адаптер «Ethernet 5» сейчас не подключён. TUN не подключится, пока он не появится, — или выберите «Автоматически».',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Сетевой адаптер для TUN' }),
    ).toHaveTextContent('Не найден — отключён?');
  });

  it('warns when the chosen adapter has no gateway', async () => {
    renderNetworkTab('VirtualBox Host-Only Network');

    expect(
      await screen.findByText(
        'У адаптера «VirtualBox Host-Only Network» нет шлюза по умолчанию — TUN не сможет достучаться через него до сервера.',
      ),
    ).toBeInTheDocument();
  });
});

describe('TUN conflict notice', () => {
  const v2rayN = {
    id: 'v2rayn',
    name: 'v2rayN',
    category: 'proxy' as const,
    processes: [{ pid: 300, image: 'v2rayN.exe' }],
    services: [],
  };

  function check(overrides: Partial<TunConflictCheck> = {}): TunConflictCheck {
    return {
      id: 1,
      scan: { supported: true, apps: [v2rayN] },
      resolved: false,
      ...overrides,
    };
  }

  it('shows what main found for the TUN attempt and closes an app on request', async () => {
    const electronApi = createElectronApiMock();
    electronApi.closeConflictingApp.mockResolvedValue({
      closed: true,
      remaining: [],
      scan: { supported: true, apps: [] },
    });
    installElectronApiMock(electronApi);

    const { rerender } = render(
      <TunConflictNotice check={check()} connectionMode="tun" />,
    );

    expect(
      screen.getByText('Запущены другие VPN или прокси-программы'),
    ).toBeInTheDocument();
    expect(screen.getByText('v2rayN')).toBeInTheDocument();
    expect(screen.getByText('Прокси-клиент')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    });
    expect(electronApi.closeConflictingApp).toHaveBeenCalledWith('v2rayn');

    // Main publishes the refreshed check in the next snapshot.
    rerender(
      <TunConflictNotice
        check={check({ scan: { supported: true, apps: [] }, resolved: true })}
        connectionMode="tun"
      />,
    );
    expect(
      screen.getByText('Готово — переподключитесь, чтобы поднять TUN.'),
    ).toBeInTheDocument();
  });

  it('stays hidden while the scan runs, when nothing is found, and outside TUN', () => {
    const { rerender, container } = render(
      <TunConflictNotice check={check({ scan: null })} connectionMode="tun" />,
    );
    expect(container).toBeEmptyDOMElement();

    rerender(
      <TunConflictNotice
        check={check({ scan: { supported: true, apps: [] } })}
        connectionMode="tun"
      />,
    );
    expect(container).toBeEmptyDOMElement();

    rerender(<TunConflictNotice check={check()} connectionMode="proxy" />);
    expect(container).toBeEmptyDOMElement();

    rerender(<TunConflictNotice check={null} connectionMode="tun" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('comes back for the next attempt after being dismissed', () => {
    installElectronApiMock(createElectronApiMock());
    const { rerender } = render(
      <TunConflictNotice check={check()} connectionMode="tun" />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Скрыть' }));
    expect(screen.queryByText('v2rayN')).toBeNull();

    // Same attempt, refreshed scan: still dismissed.
    rerender(
      <TunConflictNotice
        check={check({ scan: { supported: true, apps: [v2rayN] } })}
        connectionMode="tun"
      />,
    );
    expect(screen.queryByText('v2rayN')).toBeNull();

    rerender(
      <TunConflictNotice check={check({ id: 2 })} connectionMode="tun" />,
    );
    expect(screen.getByText('v2rayN')).toBeInTheDocument();
  });

  it('offers no close button for service-only products', () => {
    render(
      <TunConflictNotice
        check={check({
          scan: {
            supported: true,
            apps: [
              {
                id: 'wireguard',
                name: 'WireGuard',
                category: 'vpn',
                processes: [],
                services: [{ pid: 12, image: 'wireguard.exe' }],
              },
            ],
          },
        })}
        connectionMode="tun"
      />,
    );

    expect(
      screen.getByText(
        'Работает как фоновая служба — отключите VPN или выключите её в самой программе.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Закрыть' })).toBeNull();
  });
});
