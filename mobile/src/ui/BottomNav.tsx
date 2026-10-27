import React from 'react';
import clsx from 'clsx';
import { Power, Server, Settings } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { MobileTab } from './useTabHistory';

const TABS: { id: MobileTab; icon: typeof Power; labelKey: string }[] = [
  { id: 'home', icon: Power, labelKey: 'mobile.tabs.home' },
  { id: 'servers', icon: Server, labelKey: 'mobile.tabs.servers' },
  { id: 'settings', icon: Settings, labelKey: 'mobile.tabs.settings' },
];

interface BottomNavProps {
  tab: MobileTab;
  isConnected: boolean;
  onChange: (tab: MobileTab) => void;
}

export const BottomNav: React.FC<BottomNavProps> = ({
  tab,
  isConnected,
  onChange,
}) => {
  const { t } = useTranslation();
  return (
    <nav
      className="mobile-bottom-nav shrink-0 grid grid-cols-3 border-t border-gray-800/60 bg-surface/95 backdrop-blur"
      aria-label={t('settings.navAria')}
    >
      {TABS.map(({ id, icon: Icon, labelKey }) => {
        const active = tab === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            aria-current={active ? 'page' : undefined}
            className={clsx(
              'flex flex-col items-center justify-center gap-1 py-2.5 text-[11px] font-medium transition-colors',
              active ? 'text-white' : 'text-gray-500 active:text-gray-300',
            )}
          >
            <span
              className={clsx(
                'relative flex items-center justify-center w-14 h-7 rounded-full transition-colors',
                active && 'bg-primary/20',
              )}
            >
              <Icon
                className={clsx(
                  'w-5 h-5',
                  id === 'home' && isConnected && 'text-green-400',
                )}
              />
            </span>
            {t(labelKey)}
          </button>
        );
      })}
    </nav>
  );
};
