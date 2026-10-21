/* @vitest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';
import i18n from '@/renderer/i18n';
import { AppSnapshotProvider } from '@/renderer/hooks/useAppSnapshot';
import { SettingsNetworkTab } from '@/renderer/components/settings/SettingsNetworkTab';
import {
  DEFAULT_PERFORMANCE_SETTINGS,
  type PerformanceSettings,
} from '@/shared/types';
import {
  createElectronApiMock,
  installElectronApiMock,
} from '@/test/electronApiMock';

function renderNetworkTab(
  settings: Partial<PerformanceSettings> = {},
  isConnected = false,
) {
  const electronApi = createElectronApiMock();
  electronApi.getPerformanceSettings.mockResolvedValue({
    ...DEFAULT_PERFORMANCE_SETTINGS,
    ...settings,
  });
  electronApi.listRunningApps.mockResolvedValue(['chrome.exe', 'Discord.exe']);
  installElectronApiMock(electronApi);
  render(
    <AppSnapshotProvider>
      <SettingsNetworkTab
        isOpen
        isConnected={isConnected}
        isConnectionBusy={false}
      />
    </AppSnapshotProvider>,
  );
  return electronApi;
}

beforeAll(async () => {
  await i18n.changeLanguage('ru');
});

describe('Routing rules section', () => {
  it('shows only the lists the selected mode uses', async () => {
    renderNetworkTab();

    const allMode = await screen.findByRole('radio', {
      name: /Весь трафик через VPN/,
    });
    expect(allMode).toHaveAttribute('aria-checked', 'true');
    expect(
      // The datalist of running programs makes app inputs comboboxes.
      screen.getByRole('combobox', { name: 'Приложения напрямую' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('textbox', { name: 'Сайты через VPN' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('combobox', { name: 'Приложения через VPN' }),
    ).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('radio', { name: /Только выбранные сайты/ }),
    );
    expect(
      screen.getByRole('textbox', { name: 'Сайты через VPN' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Список пуст: весь трафик идёт напрямую.'),
    ).toBeInTheDocument();
  });

  it('adds apps with their real spelling and saves the routing rules', async () => {
    const electronApi = renderNetworkTab();
    electronApi.pickApplications.mockResolvedValue(['steam.exe']);

    fireEvent.click(
      await screen.findByRole('radio', {
        name: /Только выбранные приложения/,
      }),
    );
    await waitFor(() => expect(electronApi.listRunningApps).toHaveBeenCalled());

    const proxyInput = screen.getByRole('combobox', {
      name: 'Приложения через VPN',
    });
    // Running processes complete the case-sensitive name Xray compares.
    await waitFor(() =>
      expect(
        document.querySelector('datalist option[value="Discord.exe"]'),
      ).not.toBeNull(),
    );
    fireEvent.change(proxyInput, { target: { value: 'discord, bad|name' } });
    fireEvent.keyDown(proxyInput, { key: 'Enter' });
    expect(await screen.findByText('Discord.exe')).toBeInTheDocument();
    expect(
      screen.getByText('Не похоже на имя программы: bad|name'),
    ).toBeInTheDocument();
    expect(proxyInput).toHaveValue('bad|name');

    const [, directBrowse] = screen.getAllByRole('button', {
      name: 'Выбрать файл…',
    });
    fireEvent.click(directBrowse);
    expect(await screen.findByText('steam.exe')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() =>
      expect(electronApi.setPerformanceSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          routingMode: 'apps',
          proxyApps: ['Discord.exe'],
          directApps: ['steam.exe'],
        }),
      ),
    );
  });

  it('locks the rules while connected', async () => {
    renderNetworkTab({ routingMode: 'sites' }, true);

    expect(
      await screen.findByText(
        'Отключите VPN, чтобы изменить правила маршрутизации.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('radio', { name: /Только выбранные сайты/ }),
    ).toBeDisabled();
  });
});
