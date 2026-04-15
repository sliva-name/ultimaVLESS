/* @vitest-environment jsdom */
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsModal } from './SettingsModal';
import { createElectronApiMock, installElectronApiMock } from '../../test/electronApiMock';
import { makeMonitorStatus } from '../../test/factories';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: {
      language: 'en',
      changeLanguage: vi.fn(),
    },
  }),
}));

describe('SettingsModal', () => {
  beforeEach(() => {
    const electronApi = createElectronApiMock();
    installElectronApiMock(electronApi);
  });

  it('keeps mode buttons disabled until monitor status finishes loading', async () => {
    let resolveMonitorStatus: ((value: ReturnType<typeof makeMonitorStatus>) => void) | null = null;
    const monitorStatusPromise = new Promise<ReturnType<typeof makeMonitorStatus>>((resolve) => {
      resolveMonitorStatus = resolve;
    });

    const electronApi = createElectronApiMock();
    electronApi.getConnectionMonitorStatus.mockImplementation(() => monitorStatusPromise);
    installElectronApiMock(electronApi);

    render(
      <SettingsModal
        isOpen={true}
        servers={[]}
        subscriptions={[]}
        onClose={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('tab', { name: 'settings.tabs.network' }));

    const proxyModeButton = screen.getByRole('button', { name: /settings\.network\.proxyMode/ });
    const tunModeButton = screen.getByRole('button', { name: /settings\.network\.tunMode/ });

    expect(proxyModeButton).toBeDisabled();
    expect(tunModeButton).toBeDisabled();

    await act(async () => {
      resolveMonitorStatus?.(makeMonitorStatus({ isConnected: false }));
      await monitorStatusPromise;
    });

    await waitFor(() => {
      expect(proxyModeButton).not.toBeDisabled();
      expect(tunModeButton).not.toBeDisabled();
    });
  });
});
