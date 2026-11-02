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
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import i18n from '@/renderer/i18n';
import App from '@/renderer/App';
import type { AppSnapshot, SessionPhase } from '@/shared/ipc';
import {
  createElectronApiMock,
  installElectronApiMock,
  type ElectronApiMock,
} from '@/test/electronApiMock';
import {
  makeAppSnapshot,
  makeServer,
  makeSubscription,
} from '@/test/factories';

const work = makeSubscription({ id: 'work', name: 'Рабочая подписка' });
const SERVERS = [
  makeServer({
    uuid: 'de',
    name: 'Германия',
    address: 'de.example.net',
    source: 'subscription',
    subscriptionId: 'work',
    ping: 161,
    pingTime: 1,
  }),
  makeServer({
    uuid: 'nl',
    name: 'Нидерланды',
    address: 'nl.example.net',
    source: 'subscription',
    subscriptionId: 'work',
    ping: 48,
    pingTime: 1,
  }),
  makeServer({
    uuid: 'lt',
    name: 'Литва',
    address: '203.0.113.24',
    source: 'manual',
    ping: null,
    pingTime: 1,
  }),
];

function snapshotWith(
  phase: SessionPhase,
  overrides: Partial<AppSnapshot> = {},
): AppSnapshot {
  return makeAppSnapshot({
    servers: SERVERS,
    subscriptions: [work],
    selectedServerId: 'nl',
    session: {
      phase,
      activeServerId: phase === 'connected' ? 'nl' : null,
      lastError: null,
      blockedServerIds: [],
    },
    ...overrides,
  });
}

function renderApp(snapshot: AppSnapshot): ElectronApiMock {
  const electronApi = createElectronApiMock();
  electronApi.getAppSnapshot.mockResolvedValue(snapshot);
  installElectronApiMock(electronApi);
  render(<App />);
  return electronApi;
}

beforeAll(async () => {
  await i18n.changeLanguage('ru');
});

afterEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

describe('app shell', () => {
  it('lists servers by group, fastest first, with latency badges', async () => {
    renderApp(snapshotWith('idle'));

    const group = await screen.findByRole('region', {
      name: 'Рабочая подписка',
    });
    const rows = within(group).getAllByRole('button', { pressed: undefined });
    const names = rows
      .map((row) => row.getAttribute('data-server-uuid'))
      .filter(Boolean);
    expect(names).toEqual(['nl', 'de']);
    expect(within(group).getByText('48 мс')).toHaveClass('text-lat1');
    expect(within(group).getByText('161 мс')).toHaveClass('text-lat2');

    const manual = screen.getByRole('region', { name: 'Добавлены вручную' });
    expect(within(manual).getByText('Не ответил при проверке')).toBeVisible();

    // The stage shows the selected server: name, then only its address.
    expect(
      screen.getByRole('heading', { level: 1, name: 'Нидерланды' }),
    ).toBeInTheDocument();
    expect(screen.getByText('nl.example.net:443')).toBeInTheDocument();
  });

  it('locks the list while connected and offers to disconnect', async () => {
    const electronApi = renderApp(snapshotWith('connected'));

    const lock = (
      await screen.findByText('Сменить сервер можно после отключения')
    ).closest('[role="status"]') as HTMLElement;
    expect(screen.getByText('Подключено')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('server-item-de'));
    expect(electronApi.setSelectedServerId).not.toHaveBeenCalled();

    fireEvent.click(within(lock).getByRole('button', { name: 'Отключить' }));
    await waitFor(() => expect(electronApi.disconnect).toHaveBeenCalled());
  });

  it('switches Proxy/TUN from the title bar', async () => {
    const electronApi = renderApp(snapshotWith('idle'));

    const modes = await screen.findByRole('radiogroup', {
      name: 'Режим подключения',
    });
    expect(
      within(modes).getByRole('radio', { name: 'Прокси' }),
    ).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(within(modes).getByRole('radio', { name: 'TUN' }));
    await waitFor(() =>
      expect(electronApi.setConnectionMode).toHaveBeenCalledWith('tun'),
    );
  });

  it('marks Diagnostics after a failed session and opens it from the card', async () => {
    renderApp(
      snapshotWith('failed', {
        session: {
          phase: 'failed',
          activeServerId: null,
          lastError: 'Xray exited before opening local proxy ports',
          blockedServerIds: [],
        },
      }),
    );

    const card = await screen.findByRole('alert');
    const rail = screen.getByRole('navigation', { name: 'Разделы' });
    expect(
      within(rail).getByRole('button', { name: 'Диагностика' }),
    ).toHaveAttribute(
      'title',
      'Диагностика · Последнее подключение завершилось ошибкой',
    );

    fireEvent.click(within(card).getByRole('button', { name: 'Диагностика' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Диагностика' }),
    ).toBeInTheDocument();
  });

  it('walks the settings pages and applies the theme at once', async () => {
    const electronApi = renderApp(snapshotWith('idle'));

    fireEvent.click(await screen.findByRole('button', { name: 'Настройки' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Режим и сеть' }),
    ).toBeInTheDocument();

    const nav = screen.getByRole('navigation', { name: 'Разделы настроек' });
    fireEvent.click(within(nav).getByRole('button', { name: 'Оформление' }));
    fireEvent.click(await screen.findByRole('radio', { name: /Светлая/ }));

    expect(document.documentElement.dataset.theme).toBe('light');
    await waitFor(() =>
      expect(electronApi.setWindowTheme).toHaveBeenCalledWith('light'),
    );
    expect(localStorage.getItem('theme')).toBe('light');
  });

  it('asks for a first source when there are no servers', async () => {
    renderApp(makeAppSnapshot());

    expect(
      await screen.findByRole('heading', { name: 'Добавьте первый сервер' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Здесь появятся серверы')).toBeInTheDocument();
  });

  it('adds a subscription through Yandex Translate when asked', async () => {
    const electronApi = renderApp(makeAppSnapshot());
    const sub = 'https://example.com/sub?token=abc&format=base64';

    fireEvent.change(await screen.findByLabelText('Адрес подписки'), {
      target: { value: sub },
    });
    fireEvent.change(screen.getByLabelText('Название'), {
      target: { value: 'Белый список' },
    });
    const viaYandex = screen.getByRole('switch', {
      name: 'Загружать через Яндекс Переводчик',
    });
    expect(viaYandex).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(viaYandex);
    fireEvent.click(
      screen.getByRole('button', { name: 'Добавить и загрузить' }),
    );

    await waitFor(() =>
      expect(electronApi.addSubscription).toHaveBeenCalledWith({
        name: 'Белый список',
        url: `https://translate.yandex.ru/translate?url=${encodeURIComponent(sub)}&lang=de-de`,
      }),
    );
    await waitFor(() =>
      expect(viaYandex).toHaveAttribute('aria-checked', 'false'),
    );
  });

  it('offers a downloaded update in the title bar', async () => {
    const electronApi = renderApp(snapshotWith('idle'));
    await waitFor(() => expect(electronApi.getUpdateStatus).toHaveBeenCalled());
    await act(async () => undefined);

    act(() => {
      electronApi.emitUpdateStatus({
        stage: 'downloaded',
        version: '7.22.0',
        releaseNotes: null,
        percent: 100,
        bytesPerSecond: 0,
        error: null,
        updatedAt: 1,
      });
    });
    fireEvent.click(
      await screen.findByRole('button', { name: /Обновить до 7\.22\.0/ }),
    );
    await waitFor(() => expect(electronApi.installUpdate).toHaveBeenCalled());
  });
});
