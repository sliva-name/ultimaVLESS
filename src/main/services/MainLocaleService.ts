import { EventEmitter } from 'events';
import { configService, UiLanguage } from './ConfigService';

export type MainTranslationKey =
  | 'tray.show'
  | 'tray.hide'
  | 'tray.quit'
  | 'tray.connect'
  | 'tray.disconnect'
  | 'tray.connected'
  | 'tray.disconnected'
  | 'tray.connecting'
  | 'tray.connectedTo'
  | 'tray.server'
  | 'tray.ping'
  | 'notify.connected.title'
  | 'notify.connected.body'
  | 'notify.disconnected.title'
  | 'notify.disconnected.body'
  | 'notify.error.title'
  | 'notify.switching.title'
  | 'notify.switching.body'
  | 'notify.updateAvailable.title'
  | 'notify.updateAvailable.body'
  | 'notify.updateReady.title'
  | 'notify.updateReady.body';

const STRINGS: Record<UiLanguage, Record<MainTranslationKey, string>> = {
  en: {
    'tray.show': 'Show',
    'tray.hide': 'Hide',
    'tray.quit': 'Quit',
    'tray.connect': 'Connect',
    'tray.disconnect': 'Disconnect',
    'tray.connected': 'Connected',
    'tray.disconnected': 'Disconnected',
    'tray.connecting': 'Connecting…',
    'tray.connectedTo': 'Connected to {name}',
    'tray.server': 'Server',
    'tray.ping': 'Ping: {ping} ms',
    'notify.connected.title': 'UltimaVLESS — Connected',
    'notify.connected.body': 'Tunnel to {name} is up',
    'notify.disconnected.title': 'UltimaVLESS — Disconnected',
    'notify.disconnected.body': 'VPN tunnel was closed',
    'notify.error.title': 'UltimaVLESS — Connection error',
    'notify.switching.title': 'UltimaVLESS — Switching server',
    'notify.switching.body':
      'Current server looks blocked, trying another one…',
    'notify.updateAvailable.title': 'UltimaVLESS — Update available',
    'notify.updateAvailable.body':
      'Version {version} is being downloaded in the background.',
    'notify.updateReady.title': 'UltimaVLESS — Update ready',
    'notify.updateReady.body':
      'Version {version} will install on next restart.',
  },
  ru: {
    'tray.show': 'Показать',
    'tray.hide': 'Скрыть',
    'tray.quit': 'Выход',
    'tray.connect': 'Подключить',
    'tray.disconnect': 'Отключить',
    'tray.connected': 'Подключено',
    'tray.disconnected': 'Отключено',
    'tray.connecting': 'Подключение…',
    'tray.connectedTo': 'Подключено к {name}',
    'tray.server': 'Сервер',
    'tray.ping': 'Пинг: {ping} мс',
    'notify.connected.title': 'UltimaVLESS — подключено',
    'notify.connected.body': 'Туннель до {name} поднят',
    'notify.disconnected.title': 'UltimaVLESS — отключено',
    'notify.disconnected.body': 'VPN-туннель закрыт',
    'notify.error.title': 'UltimaVLESS — ошибка подключения',
    'notify.switching.title': 'UltimaVLESS — смена сервера',
    'notify.switching.body':
      'Текущий сервер выглядит заблокированным, пробуем другой…',
    'notify.updateAvailable.title': 'UltimaVLESS — доступно обновление',
    'notify.updateAvailable.body': 'Версия {version} загружается в фоне.',
    'notify.updateReady.title': 'UltimaVLESS — обновление готово',
    'notify.updateReady.body':
      'Версия {version} установится при следующем запуске.',
  },
};

function format(
  template: string,
  params: Record<string, string | number | null | undefined>,
): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = params[key];
    return value === null || value === undefined ? '' : String(value);
  });
}

class MainLocaleService extends EventEmitter {
  private language: UiLanguage;

  constructor() {
    super();
    this.language = configService.getUiLanguage();
  }

  public getLanguage(): UiLanguage {
    return this.language;
  }

  public setLanguage(language: UiLanguage): void {
    if (this.language === language) return;
    this.language = language;
    configService.setUiLanguage(language);
    this.emit('language-changed', language);
  }

  public t(
    key: MainTranslationKey,
    params: Record<string, string | number | null | undefined> = {},
  ): string {
    const table = STRINGS[this.language] ?? STRINGS.en;
    const template = table[key] ?? STRINGS.en[key] ?? key;
    return format(template, params);
  }
}

export const mainLocaleService = new MainLocaleService();
