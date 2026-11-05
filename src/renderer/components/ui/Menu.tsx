import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { MoreHorizontal, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { anchorPopup, type PopupPosition } from './anchorPopup';

export interface MenuItem {
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** Ask before running: the menu turns into a small confirmation. */
  confirm?: { title: string; body: string; action: string };
}

export const MenuSeparator = 'separator' as const;

export type MenuEntry = MenuItem | typeof MenuSeparator;

interface MenuProps {
  /** Names the trigger and the menu. */
  label: string;
  items: MenuEntry[];
  /** 24 px trigger in group headers, 28 px in rows. */
  size?: 24 | 28;
  disabled?: boolean;
}

const MENU_WIDTH = 248;

/** Items are 32 px, separators 9 px, plus the padding and border. */
function menuHeight(items: MenuEntry[]): number {
  return (
    items.reduce((sum, entry) => sum + (entry === MenuSeparator ? 9 : 32), 0) +
    10
  );
}

/**
 * "···" button with a popup menu: opens under the trigger, aligned to its
 * right edge; arrows move, Enter runs, Escape closes. An item with `confirm`
 * asks first, in place.
 */
export const Menu: React.FC<MenuProps> = ({
  label,
  items,
  size = 24,
  disabled = false,
}) => {
  const { t } = useTranslation();
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<PopupPosition>();
  const [confirming, setConfirming] = useState<MenuItem | null>(null);
  const [active, setActive] = useState(0);

  const actionable = items.filter(
    (entry): entry is MenuItem => entry !== MenuSeparator && !entry.disabled,
  );

  const close = useCallback((refocus = true) => {
    setOpen(false);
    setConfirming(null);
    if (refocus) triggerRef.current?.focus();
  }, []);

  // Opens up near the bottom of the window instead of running off it.
  const place = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPosition(
      anchorPopup(
        rect,
        { width: MENU_WIDTH, height: menuHeight(items) },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    );
  }, [items]);

  const toggle = () => {
    if (open) {
      close();
      return;
    }
    place();
    setActive(0);
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (popupRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      close(false);
    };
    const onScrollOrResize = () => close(false);
    document.addEventListener('mousedown', onPointerDown);
    window.addEventListener('resize', onScrollOrResize);
    window.addEventListener('scroll', onScrollOrResize, true);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('resize', onScrollOrResize);
      window.removeEventListener('scroll', onScrollOrResize, true);
    };
  }, [open, close]);

  // Focus follows the highlighted item, so screen readers announce it.
  useEffect(() => {
    if (!open) return;
    const selector = confirming
      ? '[data-confirm-cancel]'
      : `[data-menu-index="${active}"]`;
    popupRef.current?.querySelector<HTMLElement>(selector)?.focus();
  }, [open, active, confirming]);

  const run = (item: MenuItem) => {
    if (item.confirm) {
      setConfirming(item);
      return;
    }
    close();
    item.onSelect();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (!confirming && event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((index) => Math.min(actionable.length - 1, index + 1));
    } else if (!confirming && event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => Math.max(0, index - 1));
    } else if (event.key === 'Tab') {
      close(false);
    }
  };

  let index = -1;
  const popup =
    open &&
    position &&
    createPortal(
      <div
        ref={popupRef}
        id={menuId}
        role={confirming ? 'alertdialog' : 'menu'}
        aria-label={confirming ? confirming.confirm?.title : label}
        onKeyDown={onKeyDown}
        style={{
          position: 'fixed',
          top: position.top,
          bottom: position.bottom,
          left: position.left,
          width: MENU_WIDTH,
        }}
        className={clsx(
          'z-[9999] rounded-xl border bg-s3 shadow-float menu-in',
          confirming ? 'p-3.5 border-bad-line' : 'p-1 border-line2',
        )}
      >
        {confirming?.confirm ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-[13px] leading-5 font-semibold text-fg">
                {confirming.confirm.title}
              </span>
              <span className="text-xs leading-4 text-fg2">
                {confirming.confirm.body}
              </span>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                data-confirm-cancel
                onClick={() => close()}
                className="h-7 px-2.5 rounded-md border border-line2 bg-transparent text-fg text-xs leading-4 font-normal hover:bg-s2"
              >
                {t('servers.cancel')}
              </button>
              <button
                type="button"
                onClick={() => {
                  const item = confirming;
                  close();
                  item.onSelect();
                }}
                className="h-7 px-2.5 rounded-md bg-bad-fill text-white text-xs leading-4 font-normal hover:brightness-110"
              >
                {confirming.confirm.action}
              </button>
            </div>
          </div>
        ) : (
          items.map((entry, position) => {
            if (entry === MenuSeparator) {
              return (
                <span
                  key={`separator-${position}`}
                  role="separator"
                  className="block h-px my-1 mx-2 bg-line2"
                />
              );
            }
            if (!entry.disabled) index += 1;
            const itemIndex = entry.disabled ? -1 : index;
            const Icon = entry.icon;
            return (
              <button
                key={entry.label}
                type="button"
                role="menuitem"
                disabled={entry.disabled}
                data-menu-index={itemIndex}
                tabIndex={itemIndex === active ? 0 : -1}
                onMouseEnter={() => itemIndex >= 0 && setActive(itemIndex)}
                onClick={() => run(entry)}
                className={clsx(
                  'w-full h-8 flex items-center gap-2.5 px-2.5 rounded-md text-left text-[13px] leading-5 outline-none',
                  'disabled:opacity-45',
                  entry.danger ? 'text-bad' : 'text-fg',
                  itemIndex === active && 'bg-thumb',
                )}
              >
                <Icon
                  aria-hidden
                  strokeWidth={1.75}
                  className="w-4 h-4 shrink-0"
                />
                <span className="flex-1 truncate">{entry.label}</span>
              </button>
            );
          })
        )}
      </div>,
      document.body,
    );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
        onClick={toggle}
        className={clsx(
          'shrink-0 inline-flex items-center justify-center rounded-md text-fg3 transition-colors duration-150',
          'hover:bg-s3 hover:text-fg disabled:opacity-45',
          open && 'bg-thumb text-fg',
          size === 24 ? 'w-6 h-6' : 'w-7 h-7',
        )}
      >
        <MoreHorizontal
          aria-hidden
          strokeWidth={2}
          className={size === 24 ? 'w-3.5 h-3.5' : 'w-4 h-4'}
        />
      </button>
      {popup}
    </>
  );
};
