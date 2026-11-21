/* @vitest-environment jsdom */
import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';
import i18n from '@/renderer/i18n';
import { CorePage } from '@/renderer/pages/settings/CorePage';
import {
  DEFAULT_PERFORMANCE_SETTINGS,
  type PerformanceSettings,
} from '@/shared/types';
import {
  createElectronApiMock,
  installElectronApiMock,
} from '@/test/electronApiMock';
import { renderWithNetwork } from '@/test/renderPage';

const UP = 'Скорость отдачи, Мбит/с';
const DOWN = 'Скорость загрузки, Мбит/с';

function renderCorePage(overrides: Partial<PerformanceSettings> = {}) {
  const electronApi = createElectronApiMock();
  electronApi.getPerformanceSettings.mockResolvedValue({
    ...DEFAULT_PERFORMANCE_SETTINGS,
    ...overrides,
  });
  installElectronApiMock(electronApi);
  renderWithNetwork((net) => <CorePage net={net} />);
  return electronApi;
}

function type(field: HTMLElement, text: string): void {
  fireEvent.change(field, { target: { value: text } });
  fireEvent.blur(field);
}

beforeAll(async () => {
  await i18n.changeLanguage('ru');
});

describe('Hysteria2 speed fields', () => {
  it('shows an unset speed as an empty field, with the speed-test warning', async () => {
    renderCorePage();
    const up = await screen.findByRole('textbox', { name: UP });
    expect(up).toHaveValue('');
    expect(screen.getByRole('textbox', { name: DOWN })).toHaveValue('');
    expect(
      screen.getByText(/измеренную спидтестом без VPN, а не максимум тарифа/),
    ).toBeInTheDocument();
  });

  it('saves a typed speed, a comma as the decimal point', async () => {
    const electronApi = renderCorePage({ hysteriaDownMbps: 100 });
    const down = await screen.findByRole('textbox', { name: DOWN });
    await waitFor(() => expect(down).toHaveValue('100'));

    const up = screen.getByRole('textbox', { name: UP });
    type(up, '12,5');
    expect(up).toHaveValue('12.5');
    // Below what Xray accepts: raised to 0.5.
    type(down, '0.1');
    expect(down).toHaveValue('0.5');

    fireEvent.click(await screen.findByRole('button', { name: 'Сохранить' }));
    await waitFor(() =>
      expect(electronApi.setPerformanceSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          hysteriaUpMbps: 12.5,
          hysteriaDownMbps: 0.5,
        }),
      ),
    );
  });

  it('clears a speed back to "not set" and resets with the page', async () => {
    const electronApi = renderCorePage({
      hysteriaUpMbps: 40,
      hysteriaDownMbps: 200,
    });
    const up = await screen.findByRole('textbox', { name: UP });
    await waitFor(() => expect(up).toHaveValue('40'));

    type(up, '');
    expect(up).toHaveValue('');
    fireEvent.click(await screen.findByRole('button', { name: 'Сохранить' }));
    await waitFor(() =>
      expect(electronApi.setPerformanceSettings).toHaveBeenCalledWith(
        expect.objectContaining({ hysteriaUpMbps: 0, hysteriaDownMbps: 200 }),
      ),
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Сбросить по умолчанию' }),
    );
    expect(screen.getByRole('textbox', { name: DOWN })).toHaveValue('');
  });
});
