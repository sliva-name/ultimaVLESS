import React from 'react';
import clsx from 'clsx';
import {
  Cpu,
  Globe,
  Info,
  Palette,
  Power,
  type LucideIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ConnectionMode } from '@/shared/types';
import type { NetworkSettings } from '@/renderer/hooks/useNetworkSettings';
import type { ThemePreference } from '@/renderer/hooks/useTheme';
import { NetworkPage } from './NetworkPage';
import { DnsPage } from './DnsPage';
import { CorePage } from './CorePage';
import { AppearancePage } from './AppearancePage';
import { AboutPage } from './AboutPage';

export type SettingsPageId =
  'network' | 'dns' | 'core' | 'appearance' | 'about';

const PAGES: { id: SettingsPageId; icon: LucideIcon; label: string }[] = [
  { id: 'network', icon: Power, label: 'pages.network.title' },
  { id: 'dns', icon: Globe, label: 'pages.dns.title' },
  { id: 'core', icon: Cpu, label: 'pages.core.title' },
  { id: 'appearance', icon: Palette, label: 'pages.appearance.title' },
  { id: 'about', icon: Info, label: 'pages.about.title' },
];

interface SettingsSectionProps {
  page: SettingsPageId;
  onPage: (page: SettingsPageId) => void;
  net: NetworkSettings;
  onModeChange: (mode: ConnectionMode) => void;
  theme: {
    preference: ThemePreference;
    setPreference: (theme: ThemePreference) => void;
  };
}

/** «Настройки» in the rail: a 184 px page list and the page. */
export const SettingsSection: React.FC<SettingsSectionProps> = ({
  page,
  onPage,
  net,
  onModeChange,
  theme,
}) => {
  const { t } = useTranslation();
  return (
    <>
      <nav
        aria-label={t('settings.navAria')}
        className="w-[184px] shrink-0 box-border flex flex-col gap-0.5 pt-6 px-2 pb-4 bg-s1 border-r border-line"
      >
        <span className="px-2.5 pb-3 text-[11px] leading-4 font-semibold tracking-[0.06em] uppercase text-fg3">
          {t('pages.settingsNav')}
        </span>
        {PAGES.map(({ id, icon: Icon, label }) => {
          const on = id === page;
          return (
            <button
              key={id}
              type="button"
              aria-current={on ? 'page' : undefined}
              onClick={() => onPage(id)}
              className={clsx(
                'h-[30px] flex items-center gap-2 px-2.5 rounded-md text-left text-[13px] leading-4 whitespace-nowrap',
                'transition-colors duration-150',
                on
                  ? 'bg-acc-soft text-fg font-medium'
                  : 'text-fg2 font-normal hover:bg-s2 hover:text-fg',
              )}
            >
              <Icon
                aria-hidden
                strokeWidth={1.75}
                className={clsx(
                  'w-4 h-4 shrink-0',
                  on ? 'text-acc' : 'text-fg3',
                )}
              />
              <span className="truncate">{t(label)}</span>
            </button>
          );
        })}
      </nav>
      {page === 'network' && (
        <NetworkPage net={net} onModeChange={onModeChange} />
      )}
      {page === 'dns' && <DnsPage net={net} />}
      {page === 'core' && <CorePage net={net} />}
      {page === 'appearance' && (
        <AppearancePage
          theme={theme.preference}
          onTheme={theme.setPreference}
        />
      )}
      {page === 'about' && <AboutPage />}
    </>
  );
};
