import type { i18n as I18n } from 'i18next';
import type { UiLanguage } from '@/shared/constants';
import en from '../locales/en.json';
import ru from '../locales/ru.json';
import zh from '../locales/zh.json';
import fa from '../locales/fa.json';
import es from '../locales/es.json';
import tr from '../locales/tr.json';

/**
 * Desktop wording that does not fit a phone: TUN is "VPN" (the system's own
 * term), apps are packages rather than executables, and logs are shared
 * rather than opened in a folder. Merged over the desktop resources.
 */
export const MOBILE_OVERRIDES: Record<
  UiLanguage,
  { translation: Record<string, unknown> }
> = {
  en,
  ru,
  zh,
  fa,
  es,
  tr,
};

export function applyMobileTranslations(i18n: I18n): void {
  for (const [language, { translation }] of Object.entries(MOBILE_OVERRIDES)) {
    i18n.addResourceBundle(language, 'translation', translation, true, true);
  }
}
