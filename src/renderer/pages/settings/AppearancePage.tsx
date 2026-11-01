import React from 'react';
import { useTranslation } from 'react-i18next';
import type { ThemePreference } from '@/renderer/hooks/useTheme';
import { ChoiceCards, Page, Panel } from '@/renderer/components/ui';

interface AppearancePageProps {
  theme: ThemePreference;
  onTheme: (theme: ThemePreference) => void;
}

// Supported languages
type Language = 'en' | 'ru' | 'zh' | 'fa' | 'es' | 'tr';

export const AppearancePage: React.FC<AppearancePageProps> = ({
  theme,
  onTheme,
}) => {
  const { t, i18n } = useTranslation();
  
  const currentLang = i18n.language.split('-')[0].toLowerCase();
  const language: Language = ['en', 'ru', 'zh', 'fa', 'es', 'tr'].includes(currentLang)
    ? (currentLang as Language)
    : 'en';

  return (
    <Page title={t('pages.appearance.title')} lead={t('pages.appearance.lead')}>
      <Panel title={t('pages.appearance.theme')}>
        <ChoiceCards<ThemePreference>
          label={t('pages.appearance.theme')}
          columns={3}
          value={theme}
          onChange={onTheme}
          options={[
            {
              value: 'system',
              label: t('pages.appearance.themeSystem'),
              desc: t('pages.appearance.themeSystemDesc'),
              preview: ['#f3f3f0', '#0e0f11'],
            },
            {
              value: 'light',
              label: t('pages.appearance.themeLight'),
              desc: t('pages.appearance.themeLightDesc'),
              preview: ['#ffffff', '#f3f3f0'],
            },
            {
              value: 'dark',
              label: t('pages.appearance.themeDark'),
              desc: t('pages.appearance.themeDarkDesc'),
              preview: ['#151619', '#0e0f11'],
            },
          ]}
        />
      </Panel>

      <Panel title={t('pages.appearance.language')}>
        <ChoiceCards<Language>
          label={t('pages.appearance.language')}
          columns={3} 
          value={language}
          onChange={(next) => void i18n.changeLanguage(next)}
          options={[
            { value: 'ru', label: 'Русский', desc: 'Интерфейс, трей и уведомления' },
            { value: 'en', label: 'English', desc: 'Interface, tray and notifications' },
            { value: 'zh', label: '中文', desc: '界面、托盘和通知' },
            { value: 'fa', label: 'فارسی', desc: 'رابط، سینی и اعلان‌ها' },
            { value: 'es', label: 'Español', desc: 'Interfaz, bandeja y notificaciones' },
            { value: 'tr', label: 'Türkçe', desc: 'Arayüz, tepsi ve bildirimler' },
          ]}
        />
      </Panel>
    </Page>
  );
};
