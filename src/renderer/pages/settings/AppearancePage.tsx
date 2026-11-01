import React from 'react';
import { useTranslation } from 'react-i18next';
import type { ThemePreference } from '@/renderer/hooks/useTheme';
import { ChoiceCards, Page, Panel } from '@/renderer/components/ui';

interface AppearancePageProps {
  theme: ThemePreference;
  onTheme: (theme: ThemePreference) => void;
}

type Language = 'ru' | 'en' | 'zh' | 'fa' | 'es' | 'tr';

/** «Оформление»: theme and language, applied at once. */
export const AppearancePage: React.FC<AppearancePageProps> = ({
  theme,
  onTheme,
}) => {
  const { t, i18n } = useTranslation();
  
  const language = i18n.language as Language;

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
          value={language}
          onChange={(next) => void i18n.changeLanguage(next)}
          options={[
            {
              value: 'ru',
              label: 'Русский',
              desc: t('pages.appearance.languageRuDesc'),
            },
            {
              value: 'en',
              label: 'English',
              desc: t('pages.appearance.languageEnDesc'),
            },
            {
              value: 'zh',
              label: '简体中文',
              desc: t('pages.appearance.languageZhDesc'),
            },
            {
              value: 'fa',
              label: 'فارسی',
              desc: t('pages.appearance.languageFaDesc'),
            },
            {
              value: 'es',
              label: 'Español',
              desc: t('pages.appearance.languageEsDesc'),
            },
            {
              value: 'tr',
              label: 'Türkçe',
              desc: t('pages.appearance.languageTrDesc'),
            },
          ]}
        />
      </Panel>
    </Page>
  );
};
