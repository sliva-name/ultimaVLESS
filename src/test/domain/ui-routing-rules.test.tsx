/* @vitest-environment jsdom */
import React from 'react';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';
import i18n from '@/renderer/i18n';
import { RoutingPage } from '@/renderer/pages/RoutingPage';
import type { AppOption } from '@/shared/appRouting';
import {
  DEFAULT_PERFORMANCE_SETTINGS,
  type PerformanceSettings,
} from '@/shared/types';
import {
  createElectronApiMock,
  installElectronApiMock,
} from '@/test/electronApiMock';
import { makeAppSnapshot } from '@/test/factories';
import { renderWithNetwork } from '@/test/renderPage';

const CHROME_ICON = 'data:image/png;base64,Q0hST01F';
const DISCORD_ICON = 'data:image/png;base64,RElTQ09SRA==';
const STEAM_ICON = 'data:image/png;base64,U1RFQU0=';

const RUNNING: AppOption[] = [
  {
    name: 'chrome.exe',
    description: 'Google Chrome',
    icon: CHROME_ICON,
    system: false,
  },
  {
    name: 'Discord.exe',
    description: 'Discord',
    icon: DISCORD_ICON,
    system: false,
  },
  { name: 'Telegram.exe', description: null, icon: null, system: false },
  {
    name: 'explorer.exe',
    description: 'Windows Explorer',
    icon: null,
    system: true,
  },
];

function renderRoutingPage(
  settings: Partial<PerformanceSettings> = {},
  isConnected = false,
) {
  const electronApi = createElectronApiMock();
  electronApi.getPerformanceSettings.mockResolvedValue({
    ...DEFAULT_PERFORMANCE_SETTINGS,
    ...settings,
  });
  electronApi.listRunningApps.mockResolvedValue(RUNNING);
  if (isConnected) {
    electronApi.getAppSnapshot.mockResolvedValue(
      makeAppSnapshot({
        session: {
          phase: 'connected',
          activeServerId: 'server-1',
          lastError: null,
          blockedServerIds: [],
        },
      }),
    );
  }
  installElectronApiMock(electronApi);
  renderWithNetwork((net) => <RoutingPage net={net} />);
  return electronApi;
}

function chipIcon(name: string): string | null {
  return (
    screen.getByText(name).closest('li')?.querySelector('img')?.src ?? null
  );
}

beforeAll(async () => {
  await i18n.changeLanguage('ru');
});

describe('Routing rules section', () => {
  it('shows only the lists the selected mode uses', async () => {
    renderRoutingPage();

    const allMode = await screen.findByRole('radio', {
      name: /Весь трафик через VPN/,
    });
    expect(allMode).toHaveAttribute('aria-checked', 'true');
    expect(
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

  it('offers running programs with icons in a scrollable list', async () => {
    const electronApi = renderRoutingPage();
    await waitFor(() => expect(electronApi.listRunningApps).toHaveBeenCalled());

    const input = await screen.findByRole('combobox', {
      name: 'Приложения напрямую',
    });
    fireEvent.click(input);
    const listbox = await screen.findByRole('listbox', {
      name: 'Приложения напрямую',
    });
    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(listbox).toHaveClass('overflow-y-auto');
    expect(listbox.style.maxHeight).not.toBe('');

    const options = within(listbox).getAllByRole('option');
    // Description first, file name below; main already sorted the list.
    expect(options.map((option) => option.textContent)).toEqual([
      'Google Chromechrome.exe',
      'DiscordDiscord.exe',
      'Telegram.exe',
      'Windows Explorerexplorer.exe',
    ]);
    expect(options[0].querySelector('img')?.src).toBe(CHROME_ICON);
    // No icon readable: a generic glyph instead of a broken image.
    expect(options[2].querySelector('img')).toBeNull();
    // Windows components are grouped after the user's programs.
    expect(within(listbox).getByText('Windows')).toBeInTheDocument();

    // Typing filters by file name and description.
    fireEvent.change(input, { target: { value: 'chro' } });
    expect(
      within(listbox)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Google Chromechrome.exe']);

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('adds apps from the list, by keyboard, by name and from a file', async () => {
    const electronApi = renderRoutingPage();
    electronApi.pickApplications.mockResolvedValue([
      { name: 'steam.exe', description: null, icon: STEAM_ICON, system: false },
    ]);

    fireEvent.click(
      await screen.findByRole('radio', {
        name: /Только выбранные приложения/,
      }),
    );
    await waitFor(() => expect(electronApi.listRunningApps).toHaveBeenCalled());

    const proxyInput = screen.getByRole('combobox', {
      name: 'Приложения через VPN',
    });
    // Typing highlights the best match; Enter picks it.
    fireEvent.change(proxyInput, { target: { value: 'disc' } });
    fireEvent.keyDown(proxyInput, { key: 'Enter' });
    expect(await screen.findByText('Discord.exe')).toBeInTheDocument();
    expect(proxyInput).toHaveValue('');
    expect(chipIcon('Discord.exe')).toBe(DISCORD_ICON);

    // Arrow keys walk the list; programs already added are not offered.
    fireEvent.click(proxyInput);
    const listbox = await screen.findByRole('listbox', {
      name: 'Приложения через VPN',
    });
    expect(within(listbox).queryByText('Discord')).not.toBeInTheDocument();
    fireEvent.keyDown(proxyInput, { key: 'ArrowDown' });
    fireEvent.keyDown(proxyInput, { key: 'ArrowDown' });
    fireEvent.keyDown(proxyInput, { key: 'Enter' });
    expect(await screen.findByText('Telegram.exe')).toBeInTheDocument();
    // Moving focus away closes the list.
    fireEvent.blur(proxyInput);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    // A typed name gets the running program's exact spelling.
    const directInput = screen.getByRole('combobox', {
      name: 'Приложения напрямую',
    });
    fireEvent.change(directInput, { target: { value: 'CHROME, bad|name' } });
    fireEvent.keyDown(directInput, { key: 'Enter' });
    expect(
      await screen.findByRole('button', { name: 'Удалить chrome.exe' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Не похоже на имя программы: bad|name'),
    ).toBeInTheDocument();
    expect(directInput).toHaveValue('bad|name');
    fireEvent.blur(directInput);

    const [, directBrowse] = screen.getAllByRole('button', {
      name: 'Выбрать файл…',
    });
    fireEvent.click(directBrowse);
    expect(await screen.findByText('steam.exe')).toBeInTheDocument();
    expect(chipIcon('steam.exe')).toBe(STEAM_ICON);

    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() =>
      expect(electronApi.setPerformanceSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          routingMode: 'apps',
          proxyApps: ['Discord.exe', 'Telegram.exe'],
          directApps: ['chrome.exe', 'steam.exe'],
        }),
      ),
    );
  });

  it('locks the rules while connected', async () => {
    renderRoutingPage({ routingMode: 'sites' }, true);

    expect(
      await screen.findByText(
        'Отключите VPN, чтобы изменить правила маршрутизации.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('radio', { name: /Только выбранные сайты/ }),
    ).toBeDisabled();
    expect(
      screen.getByRole('switch', { name: 'Блокировка рекламы' }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Отключить' }),
    ).toBeInTheDocument();
  });

  it('counts unsaved changes in one bar and drops them on discard', async () => {
    const electronApi = renderRoutingPage();

    fireEvent.click(
      await screen.findByRole('radio', { name: /Только выбранные сайты/ }),
    );
    fireEvent.click(
      screen.getByRole('switch', { name: 'Блокировка BitTorrent' }),
    );

    expect(await screen.findByText('2 изменения')).toBeInTheDocument();
    expect(
      screen.getByText(/применятся при следующем подключении/),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Отменить' }));
    await waitFor(() =>
      expect(screen.queryByText('2 изменения')).not.toBeInTheDocument(),
    );
    expect(
      screen.getByRole('radio', { name: /Весь трафик через VPN/ }),
    ).toHaveAttribute('aria-checked', 'true');
    expect(electronApi.setPerformanceSettings).not.toHaveBeenCalled();
  });
});
