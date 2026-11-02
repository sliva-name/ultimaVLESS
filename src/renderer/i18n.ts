import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { SUPPORTED_LANGUAGES, isSupportedLanguage, type UiLanguage } from '@/shared/constants';

import en from './locales/en.json';
import ru from './locales/ru.json';
import zh from './locales/zh.json';
import fa from './locales/fa.json';
import es from './locales/es.json';
import tr from './locales/tr.json';

const resources = { en, ru, zh, fa, es, tr } as const;

function getSystemLanguage(): UiLanguage {
  if (typeof navigator === 'undefined') return 'en';

  const systemLocales = navigator.languages?.length
    ? navigator.languages
    : [navigator.language];

  for (const locale of systemLocales) {
    // Convert locale codes such as "zh-CN" or "es-MX" to "zh" or "es".
    const baseLanguage = locale.split('-')[0].toLowerCase();

    if (isSupportedLanguage(baseLanguage)) {
      return baseLanguage;
    }
  }

  // Use English if the system language is not supported.
  return 'en';
}

const storedLanguage = localStorage.getItem('language');
const initialLanguage = isSupportedLanguage(storedLanguage)
  ? storedLanguage
  : getSystemLanguage();

i18n.use(initReactI18next).init({
  resources,
  lng: initialLanguage,
  fallbackLng: 'en',
  supportedLngs: SUPPORTED_LANGUAGES,
  interpolation: {
    escapeValue: false, // React already escapes values.
  },
});

function updateDocumentLanguage(language: string) {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = language;
    document.documentElement.dir = i18n.dir(language);
  }
}

updateDocumentLanguage(i18n.language || initialLanguage);

// Load a manually saved language from the main process, if one exists.
if (typeof window !== 'undefined' && window.electronAPI?.getUiLanguage) {
  void window.electronAPI
    .getUiLanguage()
    .then((mainLanguage) => {
      if (
        isSupportedLanguage(mainLanguage) &&
        mainLanguage !== i18n.language
      ) {
        void i18n.changeLanguage(mainLanguage);
      }
    })
    .catch(() => {
      // Keep the language already selected by the renderer.
    });
}

i18n.on('languageChanged', (language) => {
  localStorage.setItem('language', language);
  updateDocumentLanguage(language);

  if (
    typeof window !== 'undefined' &&
    window.electronAPI?.setUiLanguage &&
    isSupportedLanguage(language)
  ) {
    void window.electronAPI.setUiLanguage(language).catch(() => {
      // The main process can pick up the language on the next launch.
    });
  }
});

export default i18n;
