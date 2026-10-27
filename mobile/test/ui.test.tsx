import React from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { FakeCore } from './fakeCore';

const fake = vi.hoisted(() => ({ core: null as FakeCore | null }));

vi.mock('../src/native/UltimaCore', async () => {
  const { FakeCore: Fake } = await import('./fakeCore');
  fake.core = new Fake();
  return { UltimaCore: fake.core.plugin };
});

const LINK =
  'vless://5f1c8b3e-2a7d-4e1b-9c3a-0d6e7f8a9b10@203.0.113.10:443?encryption=none&flow=xtls-rprx-vision&security=reality&sni=www.microsoft.com&fp=chrome&pbk=SbVKOEMjK0sIlbwg4akyBg5mL5KZwwB-ed4eEE7YnRc&sid=6ba85179e30d4fc2&type=tcp#Amsterdam';

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
    expect(await screen.findByText('Сервер не выбран')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'VPN' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('picks a server on the servers tab and connects from the bottom bar', async () => {
    fireEvent.click(screen.getByRole('button', { name: /Серверы/ }));
    fireEvent.click(await screen.findByText('Amsterdam'));
    const connect = await screen.findByRole('button', { name: 'Подключить' });
    fireEvent.click(connect);
    await waitFor(() => expect(fake.core!.starts).toHaveLength(1));
    expect(
      await screen.findByRole('button', { name: 'Отключить' }),
    ).toBeInTheDocument();
  });

  it('shows the settings tabs with Android wording', async () => {
    fireEvent.click(screen.getByRole('button', { name: /Настройки/ }));
    fireEvent.click(await screen.findByRole('tab', { name: /Сеть/ }));
    expect(await screen.findByText('Только прокси')).toBeInTheDocument();
    expect(screen.queryByText(/UAC|Windows/)).not.toBeInTheDocument();
  });
});
