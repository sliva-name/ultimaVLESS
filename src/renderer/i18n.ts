import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import {
  DEFAULT_LANGUAGE,
  SUPPORTED_LANGUAGES,
  isSupportedLanguage,
} from '@/shared/constants';

import en from './locales/en.json';
import ru from './locales/ru.json';
import zh from './locales/zh.json';
import fa from './locales/fa.json';
import es from './locales/es.json';
import tr from './locales/tr.json';

const resources = { en, ru, zh, fa, es, tr };

function readSavedLanguage() {
  try {
    const saved = localStorage.getItem('language');
    return isSupportedLanguage(saved) ? saved : DEFAULT_LANGUAGE;
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

/**
 * `lang` for fonts and screen readers. The layout stays left-to-right in
 * every language, Farsi included.
 */
function applyDocumentLanguage(language: string) {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = language;
}

void i18n.use(initReactI18next).init({
  resources,
  lng: readSavedLanguage(),
  fallbackLng: 'en',
  supportedLngs: SUPPORTED_LANGUAGES,
  interpolation: {
    escapeValue: false, // React already escapes values
  },
});

applyDocumentLanguage(i18n.language);

// Hydrate from the main-process stored language (if available) and keep both
// persisted stores in sync so the tray, window title, and native notifications
// can use the same locale without the renderer being open.
if (typeof window !== 'undefined' && window.electronAPI?.getUiLanguage) {
  void window.electronAPI
    .getUiLanguage()
    .then((mainLang) => {
      if (isSupportedLanguage(mainLang) && mainLang !== i18n.language) {
        void i18n.changeLanguage(mainLang);
      }
    })
    .catch(() => {
      /* ignore — renderer already has a sensible default */
    });
}

i18n.on('languageChanged', (lng) => {
  try {
    localStorage.setItem('language', lng);
  } catch {
    /* the main process keeps the choice anyway */
  }
  applyDocumentLanguage(lng);
  if (
    typeof window !== 'undefined' &&
    window.electronAPI?.setUiLanguage &&
    isSupportedLanguage(lng)
  ) {
    void window.electronAPI.setUiLanguage(lng).catch(() => {
      /* non-fatal: main process will pick up the language on next launch */
    });
  }
});

export default i18n;
