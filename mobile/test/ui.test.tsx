import React from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import type { FakeCore } from './fakeCore';

const fake = vi.hoisted(() => ({ core: null as FakeCore | null }));

vi.mock('../src/native/UltimaCore', async () => {
  const { FakeCore: Fake } = await import('./fakeCore');
  fake.core = new Fake();
  return { UltimaCore: fake.core.plugin };
});

const LINK =
  'vless://5f1c8b3e-2a7d-4e1b-9c3a-0d6e7f8a9b10@203.0.113.10:443?encryption=none&flow=xtls-rprx-vision&security=reality&sni=www.microsoft.com&fp=chrome&pbk=SbVKOEMjK0sIlbwg4akyBg5mL5KZwwB-ed4eEE7YnRc&sid=6ba85179e30d4fc2&type=tcp#Amsterdam';

const nav = () => screen.getByRole('navigation', { name: 'Разделы' });
const openTab = (name: string) =>
  fireEvent.click(within(nav()).getByRole('button', { name }));

describe('mobile UI', () => {
  beforeAll(async () => {
    Object.defineProperty(process, 'platform', { value: 'android' });
    await import('../src/polyfills');
    await import('../src/native/UltimaCore');
    fake.core!.state = JSON.stringify({
      subscriptions: [
        {
          id: 'off',
          name: 'Off',
          url: 'https://example.com/s',
          enabled: false,
        },
      ],
      manualLinksInput: LINK,
      uiLanguage: 'ru',
    });
    const { bootBackend } = await import('../src/backend/boot');
    await bootBackend();
    await window.electronAPI.saveManualLinks(LINK);
    const { default: i18n } = await import('@/renderer/i18n');
    await i18n.changeLanguage('ru');
    const { applyMobileTranslations } = await import('../src/ui/i18nOverrides');
    applyMobileTranslations(i18n);
    const { MobileApp } = await import('../src/ui/MobileApp');
    render(<MobileApp />);
  });

  it('opens on the home screen with the VPN mode chosen', async () => {
    expect(
      await screen.findByRole('button', {
        name: 'Выберите сервер для подключения',
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'VPN' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    // No server picked yet: the dial cannot start a session.
    expect(screen.getByRole('button', { name: 'Подключить' })).toBeDisabled();
  });

  it('picks a server on the servers tab and connects from the floating card', async () => {
    openTab('Серверы');
    fireEvent.click(await screen.findByText('Amsterdam'));
    const connect = await screen.findByRole('button', { name: 'Подключить' });
    fireEvent.click(connect);
    await waitFor(() => expect(fake.core!.starts).toHaveLength(1));
    expect(
      await screen.findByText('Сменить сервер можно после отключения'),
    ).toBeInTheDocument();
    expect(await screen.findByText('Подключено · VPN')).toBeInTheDocument();
  });

  it('localizes the notification: server name as title, mode and units in the text', () => {
    const start = fake.core!.starts[0];
    expect(start.sessionName).toBe('Amsterdam');
    expect(start.text).toMatchObject({
      vpn: 'VPN',
      proxyOnly: 'Только прокси · SOCKS5 :10808 · HTTP :10809',
      disconnect: 'Отключить',
      rateUnits: ['Б/с', 'КБ/с', 'МБ/с'],
      decimalSeparator: ',',
    });
  });

  it('shows the protected dial and the server card on the home screen', async () => {
    openTab('Главная');
    expect(
      await screen.findByRole('button', { name: 'Отключить' }),
    ).toHaveTextContent('Защищено');
    expect(screen.getByText('VLESS · REALITY')).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: 'Сервер: Amsterdam. Открыть список серверов',
      }),
    ).toBeInTheDocument();
  });

  it('keeps the network settings read-only while connected, but not the mode', async () => {
    openTab('Настройки');
    fireEvent.click(await screen.findByRole('button', { name: /Режим и DNS/ }));
    expect(
      await screen.findByText(
        'Отключите VPN, чтобы изменить настройки производительности.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Только прокси/ })).toBeEnabled();
    expect(screen.getByRole('radio', { name: /TCP-пинг/ })).toBeDisabled();
    expect(screen.queryByText(/UAC|Windows/)).not.toBeInTheDocument();
  });

  it('goes back to the settings list with the back button', async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    expect(
      await screen.findByRole('button', { name: /Подписки и импорт/ }),
    ).toBeInTheDocument();
  });

  it('picks a direct app from the installed list and saves it', async () => {
    fireEvent.click(screen.getByRole('button', { name: /Маршрутизация/ }));
    fireEvent.click(
      await screen.findByText('Отключить', { selector: 'button' }),
    );
    await waitFor(() =>
      expect(
        screen.queryByText(
          'Отключите VPN, чтобы изменить правила маршрутизации.',
        ),
      ).not.toBeInTheDocument(),
    );
    const directApps = screen.getByRole('region', {
      name: 'Приложения напрямую',
    });
    fireEvent.click(
      within(directApps).getByRole('button', {
        name: /Выбрать из установленных/,
      }),
    );
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Telegram' }));
    expect(screen.getByText('Выбрано: 1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));

    expect(await screen.findByText('1 изменение')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(async () =>
      expect(
        (await window.electronAPI.getPerformanceSettings()).directApps,
      ).toEqual(['org.telegram.messenger']),
    );
    expect(screen.queryByText('1 изменение')).not.toBeInTheDocument();
  });

  it('opens a subscription menu outside the card that would clip it', async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    fireEvent.click(
      await screen.findByRole('button', { name: /Подписки и импорт/ }),
    );
    const trigger = await screen.findByRole('button', {
      name: 'Действия: Off',
    });
    // The rounded card clips its content to keep the corners.
    const card = trigger.closest('.overflow-hidden');
    expect(card).not.toBeNull();

    fireEvent.click(trigger);
    const menu = screen.getByRole('menu', { name: 'Действия: Off' });
    expect(menu.parentElement).toBe(document.body);
    expect(card!.contains(menu)).toBe(false);
    expect(menu.closest('.overflow-hidden')).toBeNull();
    expect(menu).toHaveClass('fixed');
    expect(
      within(menu).getByRole('menuitem', { name: 'Включить подписку' }),
    ).toBeInTheDocument();

    // The system back closes the menu and stays on the page.
    history.back();
    await waitFor(() =>
      expect(screen.queryByRole('menu')).not.toBeInTheDocument(),
    );
    expect(
      screen.getByRole('heading', { name: 'Подписки и импорт' }),
    ).toBeInTheDocument();
  });

  it('switches the interface to English', async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    fireEvent.click(await screen.findByRole('radio', { name: 'EN' }));
    expect(
      await screen.findByRole('heading', { name: 'Settings' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Mode and DNS/ }),
    ).toBeInTheDocument();
  });
});
