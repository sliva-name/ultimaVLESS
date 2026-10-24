/* @vitest-environment jsdom */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import i18n from '@/renderer/i18n';
import { ConnectionStatus } from '@/renderer/components/ConnectionStatus';
import {
  assertAllowInsecureNotUsed,
  assertEncryptedPublicOutbound,
  assertSupportedShadowsocksMethod,
} from '@/main/services/configGenerator/outboundCompat';
import { summarizeStartupFailure } from '@/main/services/xray/startupFailure';
import { localizeError } from '@/shared/localizeError';
import {
  createElectronApiMock,
  installElectronApiMock,
} from '@/test/electronApiMock';
import { makeServer } from '@/test/factories';

function thrownMessage(fn: () => void): string {
  try {
    fn();
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error('expected a throw');
}

/** Leftover English words mean the phrase table no longer matches the code. */
const ENGLISH_PROSE = /\b(?:requires|removed|instead|Set|use|is|was|for)\b/;

describe('localizeError', () => {
  it('translates the compatibility errors the config generator throws', () => {
    const messages = [
      thrownMessage(() =>
        assertEncryptedPublicOutbound({
          protocol: 'vless',
          address: 'example.com',
          streamSecurity: 'none',
        }),
      ),
      thrownMessage(() =>
        assertEncryptedPublicOutbound({
          protocol: 'trojan',
          address: 'example.com',
          streamSecurity: 'none',
        }),
      ),
      thrownMessage(() =>
        assertEncryptedPublicOutbound({
          protocol: 'hysteria',
          address: 'example.com',
          streamSecurity: 'none',
        }),
      ),
      thrownMessage(() => assertAllowInsecureNotUsed(true)),
      thrownMessage(() => assertSupportedShadowsocksMethod('none')),
      thrownMessage(() => assertSupportedShadowsocksMethod('')),
    ];
    for (const message of messages) {
      const localized = localizeError(
        `Config generation failed: ${message}`,
        'ru',
      );
      expect(localized).toMatch(/^Ошибка в конфигурации сервера: /);
      expect(localized).not.toMatch(ENGLISH_PROSE);
    }
  });

  it('keeps the reason Xray gave for exiting', () => {
    const cause = summarizeStartupFailure([
      'Failed to start: main: failed to load config files: [c.json] > infra/conf: this config must be run on version 26.10.21 or higher',
    ]);
    expect(
      localizeError(
        `Xray exited during startup (code=23, signal=none): ${cause}`,
        'ru',
      ),
    ).toBe(`Xray завершился при запуске (код 23, сигнал none): ${cause}`);
  });

  it('translates each part of a combined subscription error', () => {
    expect(
      localizeError(
        'Work: Subscription request failed: HTTP 404; Home: Could not reach the subscription server (ENOTFOUND)',
        'ru',
      ),
    ).toBe(
      'Work: Сервер подписки ответил ошибкой HTTP 404; Home: Не удалось связаться с сервером подписки (ENOTFOUND)',
    );
  });

  it('fills in values from the message', () => {
    expect(
      localizeError(
        'Port 10808 on 127.0.0.1 is already used by another program (another VPN or proxy client?). Close it and connect again.',
        'ru',
      ),
    ).toBe(
      'Порт 10808 на 127.0.0.1 занят другой программой (другим VPN или прокси-клиентом?). Закройте её и подключитесь снова.',
    );
    expect(
      localizeError(
        'TUN interface did not appear within 20s. Make sure app runs as Administrator and Xray has TUN support. Details: timeout',
        'ru',
      ),
    ).toBe(
      'TUN-интерфейс не появился за 20 с. Проверьте, что приложение запущено от имени администратора и Xray поддерживает TUN. Подробности: timeout',
    );
    expect(
      localizeError(
        'TUN setup timed out after 45s while running: apply TUN routing. Xray may not support TUN on this system.',
        'ru',
      ),
    ).toBe(
      'Настройка TUN не уложилась в 45 с (этап: apply TUN routing). Возможно, Xray не поддерживает TUN в этой системе.',
    );
    expect(localizeError('Switching from A to B', 'ru')).toBe(
      'Переключение с A на B',
    );
  });

  it('drops the Electron IPC prefix and leaves English text as is', () => {
    const message =
      "Error invoking remote method 'scan-conflicting-apps': Error: Subscription URL is required";
    expect(localizeError(message, 'en')).toBe('Subscription URL is required');
    expect(localizeError(message, 'ru')).toBe('Укажите адрес подписки');
  });

  it('passes through text it does not know', () => {
    expect(localizeError('something new', 'ru')).toBe('something new');
  });
});

describe('ConnectionStatus error', () => {
  beforeAll(async () => {
    installElectronApiMock(createElectronApiMock());
    await i18n.changeLanguage('ru');
  });

  afterAll(async () => {
    await i18n.changeLanguage('en');
  });

  it('shows a main-process error in the UI language', () => {
    render(
      <ConnectionStatus
        phase="failed"
        selectedServer={makeServer()}
        connectionError="TUN mode requires Administrator rights. Please approve UAC prompt or run UltimaVLESS as Administrator."
        onToggleConnection={() => undefined}
      />,
    );
    expect(
      screen.getByText(
        'Для режима TUN нужны права администратора. Подтвердите запрос UAC или запустите UltimaVLESS от имени администратора.',
      ),
    ).toBeInTheDocument();
  });
});
