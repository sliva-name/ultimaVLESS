import React from 'react';
import clsx from 'clsx';
import { Power, Server, SlidersHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { MobileTab } from './useMobileNav';

const TABS: { id: MobileTab; icon: typeof Power; labelKey: string }[] = [
  { id: 'home', icon: Power, labelKey: 'mobile.tabs.home' },
  { id: 'servers', icon: Server, labelKey: 'mobile.tabs.servers' },
  { id: 'settings', icon: SlidersHorizontal, labelKey: 'mobile.tabs.settings' },
];

interface BottomNavProps {
  tab: MobileTab;
  isConnected: boolean;
  onChange: (tab: MobileTab) => void;
}

/** Material 3 navigation bar: 80 dp, above the system gesture area. */
export const BottomNav: React.FC<BottomNavProps> = ({
  tab,
  isConnected,
  onChange,
}) => {
  const { t } = useTranslation();
  return (
    <nav
      className="mobile-inset-bottom shrink-0 bg-s1 border-t border-line"
      aria-label={t('mobile.navAria')}
    >
      <div className="h-20 grid grid-cols-3">
        {TABS.map(({ id, icon: Icon, labelKey }) => {
          const active = tab === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onChange(id)}
              aria-current={active ? 'page' : undefined}
              className={clsx(
                'flex flex-col items-center justify-center gap-1',
                active ? 'text-fg' : 'text-fg2',
              )}
            >
              <span
                className={clsx(
                  'w-16 h-8 rounded-2xl flex items-center justify-center transition-colors duration-150',
                  active && 'bg-acc-soft',
                )}
              >
                <Icon
                  aria-hidden
                  strokeWidth={1.75}
                  className={clsx(
                    'w-6 h-6',
                    id === 'home' && isConnected
                      ? 'text-ok'
                      : active
                        ? 'text-acc-nav'
                        : 'text-fg2',
                  )}
                />
              </span>
              <span
                className={clsx(
                  'text-xs leading-4',
                  active ? 'font-semibold' : 'font-medium',
                )}
              >
                {t(labelKey)}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
