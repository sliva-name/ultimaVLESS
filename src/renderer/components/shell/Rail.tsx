import React from 'react';
import clsx from 'clsx';
import {
  Activity,
  Layers,
  Power,
  Route,
  SlidersHorizontal,
  type LucideIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

export type Section = 'home' | 'routing' | 'subs' | 'settings' | 'diag';

interface RailProps {
  active: Section;
  onNavigate: (section: Section) => void;
  /** A verified session: the home icon turns green. */
  connected: boolean;
  /** The last session failed: a dot on Diagnostics. */
  diagAlert: boolean;
}

const ITEMS: { id: Section; icon: LucideIcon; label: string; title: string }[] =
  [
    {
      id: 'home',
      icon: Power,
      label: 'shell.rail.home',
      title: 'shell.rail.homeTitle',
    },
    {
      id: 'routing',
      icon: Route,
      label: 'shell.rail.routing',
      title: 'shell.rail.routingTitle',
    },
    {
      id: 'subs',
      icon: Layers,
      label: 'shell.rail.subs',
      title: 'shell.rail.subsTitle',
    },
    {
      id: 'settings',
      icon: SlidersHorizontal,
      label: 'shell.rail.settings',
      title: 'shell.rail.settings',
    },
    {
      id: 'diag',
      icon: Activity,
      label: 'shell.rail.diag',
      title: 'shell.rail.diag',
    },
  ];

/** 96 px navigation rail: icon over a short label. */
export const Rail: React.FC<RailProps> = ({
  active,
  onNavigate,
  connected,
  diagAlert,
}) => {
  const { t } = useTranslation();
  return (
    <nav
      aria-label={t('shell.rail.aria')}
      className="w-24 shrink-0 box-border flex flex-col items-center gap-1 pt-2 px-1 pb-3 bg-canvas border-r border-line"
    >
      {ITEMS.map(({ id, icon: Icon, label, title }) => {
        const on = id === active;
        const alert = id === 'diag' && diagAlert;
        return (
          <button
            key={id}
            type="button"
            aria-current={on ? 'page' : undefined}
            title={
              alert ? `${t(title)} · ${t('shell.rail.diagAlert')}` : t(title)
            }
            onClick={() => onNavigate(id)}
            className={clsx(
              'relative w-[88px] h-[54px] box-border px-1 rounded-lg flex flex-col items-center justify-center gap-1',
              'transition-[background-color,color] duration-150',
              on ? 'bg-acc-soft text-fg' : 'text-fg2 hover:bg-s2 hover:text-fg',
            )}
          >
            <Icon
              aria-hidden
              strokeWidth={1.75}
              className={clsx(
                'w-5 h-5',
                id === 'home' && connected
                  ? 'text-ok'
                  : on
                    ? 'text-acc-nav'
                    : 'text-fg2',
              )}
            />
            <span
              className={clsx(
                'text-[11px] leading-[14px] whitespace-nowrap',
                on ? 'font-semibold' : 'font-medium',
              )}
            >
              {t(label)}
            </span>
            {alert && (
              <span
                aria-hidden="true"
                className="absolute top-2 right-[30px] w-[7px] h-[7px] rounded-full bg-warn shadow-[0_0_0_2px_var(--color-canvas)]"
              />
            )}
          </button>
        );
      })}
    </nav>
  );
};
