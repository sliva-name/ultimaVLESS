/* @vitest-environment jsdom */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import i18n from '@/renderer/i18n';
import { Sidebar } from '@/renderer/components/Sidebar';
import {
  createElectronApiMock,
  installElectronApiMock,
} from '@/test/electronApiMock';
import { makeServer } from '@/test/factories';

beforeAll(async () => {
  installElectronApiMock(createElectronApiMock());
  await i18n.changeLanguage('ru');
});

function renderSidebar(pingBlockedWhileConnected: boolean) {
  const server = makeServer({ uuid: 'a' });
  render(
    <Sidebar
      servers={[server]}
      subscriptions={[]}
      selectedServer={server}
      isConnected
      pingBlockedWhileConnected={pingBlockedWhileConnected}
      onSelectServer={vi.fn()}
      onOpenSettings={vi.fn()}
      onPingAll={vi.fn(async () => undefined)}
      onPingSelected={vi.fn(async () => undefined)}
      onStopPing={vi.fn(async () => undefined)}
    />,
  );
}

describe('sidebar ping while connected', () => {
  it('stays available in proxy mode', () => {
    renderSidebar(false);
    expect(screen.getByRole('button', { name: 'Пинг всех' })).toBeEnabled();
    expect(
      screen.getByRole('button', { name: 'Пинг выбранного сервера' }),
    ).toBeEnabled();
  });

  it('is locked in TUN mode, where pings would go through the tunnel', () => {
    renderSidebar(true);
    expect(screen.getByRole('button', { name: 'Пинг всех' })).toBeDisabled();
  });
});
