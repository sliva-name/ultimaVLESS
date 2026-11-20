/* @vitest-environment jsdom */
import React from 'react';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import i18n from '@/renderer/i18n';
import App from '@/renderer/App';
import type { ServerDetails } from '@/shared/ipc';
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

const UUID = '3c1a510c-3862-4e0f-b007-786b0146fc14';
const LINK = `vless://${UUID}@nl.example.net:443?security=reality#NL`;

const work = makeSubscription({ id: 'work', name: 'Рабочая подписка' });

const DETAILS: ServerDetails = {
  fields: [
    { key: 'protocol', value: 'VLESS' },
    { key: 'address', value: 'nl.example.net' },
    { key: 'userId', value: UUID, secret: true },
    { key: 'security', value: 'reality' },
  ],
  shareLink: LINK,
};

function renderApp(
  source: 'subscription' | 'manual',
  details: ServerDetails | null = DETAILS,
): ElectronApiMock {
  const electronApi = createElectronApiMock();
  electronApi.getAppSnapshot.mockResolvedValue(
    makeAppSnapshot({
      servers: [
        makeServer({
          uuid: 'nl',
          name: 'Нидерланды',
          address: 'nl.example.net',
          protocol: 'vless',
          security: 'reality',
          source,
          subscriptionId: source === 'subscription' ? 'work' : undefined,
        }),
      ],
      subscriptions: [work],
      selectedServerId: 'nl',
    }),
  );
  electronApi.getServerDetails.mockResolvedValue(details);
  installElectronApiMock(electronApi);
  render(<App />);
  return electronApi;
}

async function openDetails(): Promise<HTMLElement> {
  const chip = await screen.findByRole('button', {
    name: 'Параметры сервера Нидерланды',
  });
  // A click focuses a button in Chromium; jsdom only dispatches the event.
  chip.focus();
  fireEvent.click(chip);
  return screen.findByRole('dialog', { name: 'Параметры сервера Нидерланды' });
}

beforeAll(async () => {
  await i18n.changeLanguage('ru');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('server details dialog', () => {
  it('asks main for one server only when opened, keys masked', async () => {
    const electronApi = renderApp('subscription');
    await screen.findByRole('heading', { level: 1, name: 'Нидерланды' });
    expect(electronApi.getServerDetails).not.toHaveBeenCalled();

    const dialog = await openDetails();
    expect(electronApi.getServerDetails).toHaveBeenCalledWith('nl');
    expect(
      within(dialog).getByText('Подписка «Рабочая подписка»'),
    ).toBeVisible();
    expect(await within(dialog).findByText('nl.example.net')).toBeVisible();
    expect(within(dialog).queryByText(UUID)).toBeNull();
    expect(within(dialog).queryByText(LINK)).toBeNull();
    expect(within(dialog).getByText('vless://••••••••')).toBeVisible();
    expect(
      within(dialog).queryByRole('button', { name: 'Изменить' }),
    ).toBeNull();

    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Показать ключи' }),
    );
    expect(within(dialog).getByText(UUID)).toBeVisible();
    expect(within(dialog).getByTestId('server-share-link')).toHaveTextContent(
      LINK,
    );
  });

  it('copies the link without showing it', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    renderApp('subscription');
    const dialog = await openDetails();

    fireEvent.click(
      await within(dialog).findByRole('button', { name: 'Скопировать ссылку' }),
    );
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(LINK));
    expect(
      await within(dialog).findByRole('button', { name: 'Скопировано' }),
    ).toBeVisible();
    expect(within(dialog).queryByText(LINK)).toBeNull();
  });

  it('closes on Escape and returns focus to the chip', async () => {
    renderApp('subscription');
    const dialog = await openDetails();
    await within(dialog).findByText('nl.example.net');

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Параметры сервера Нидерланды' }),
    ).toHaveFocus();
  });

  it('sends a manual server to the manual links editor', async () => {
    renderApp('manual');
    const dialog = await openDetails();
    expect(within(dialog).getByText('Добавлен вручную')).toBeVisible();

    fireEvent.click(
      await within(dialog).findByRole('button', { name: 'Изменить' }),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(
      await screen.findByRole('textbox', { name: 'Ручные конфигурации' }),
    ).toBeVisible();
  });

  it('says when an older entry has no link yet', async () => {
    renderApp('subscription', { fields: DETAILS.fields });
    const dialog = await openDetails();

    expect(
      await within(dialog).findByText(
        'Ссылка появится после следующего обновления подписок.',
      ),
    ).toBeVisible();
    expect(
      within(dialog).queryByRole('button', { name: 'Скопировать ссылку' }),
    ).toBeNull();
  });
});
