import { EventEmitter } from 'events';
import { configService } from './ConfigService';
import {
  formatMainLocaleString,
  MAIN_LOCALE_STRINGS,
} from '@/shared/mainLocales';
import type { MainTranslationKey, UiLanguage } from '@/shared/mainLocales';

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
    const table = MAIN_LOCALE_STRINGS[this.language] ?? MAIN_LOCALE_STRINGS.en;
    const template = table[key] ?? MAIN_LOCALE_STRINGS.en[key] ?? key;
    return formatMainLocaleString(template, params);
  }
}

export const mainLocaleService = new MainLocaleService();
