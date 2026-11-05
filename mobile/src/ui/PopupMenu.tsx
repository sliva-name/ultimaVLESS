import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { MoreVertical } from 'lucide-react';
import {
  anchorPopup,
  type PopupPosition,
} from '@/renderer/components/ui/anchorPopup';

export interface PopupMenuItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
}

const MENU_WIDTH = 224;
/** 48 dp items, 8 dp padding above and below, the border. */
const itemsHeight = (count: number) => count * 48 + 18;

/**
 * The area a popup may use: the scrolling page the trigger sits in, so the
 * menu stays clear of the header, the save bar, the navigation bar and the
 * gesture strip.
 */
function visibleArea(trigger: HTMLElement): { top: number; bottom: number } {
  for (let node = trigger.parentElement; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if (overflow === 'auto' || overflow === 'scroll') {
      const rect = node.getBoundingClientRect();
      if (rect.height > 0) return { top: rect.top, bottom: rect.bottom };
    }
  }
  return { top: 0, bottom: window.innerHeight };
}

interface PopupMenuProps {
  /** Names the ⋮ button and the menu. */
  label: string;
  items: PopupMenuItem[];
  className?: string;
}

/**
 * ⋮ button with a menu drawn over the whole screen, so the rounded card the
 * row sits in cannot clip it. Opens under the button, or above it when it
 * does not fit; a tap outside, the system back, scrolling or Escape close it.
 */
export const PopupMenu: React.FC<PopupMenuProps> = ({
  label,
  items,
  className,
}) => {
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<PopupPosition | null>(null);
  const open = position !== null;

  const openMenu = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const area = visibleArea(trigger);
    setPosition(
      anchorPopup(
        trigger.getBoundingClientRect(),
        { width: MENU_WIDTH, height: itemsHeight(items.length) },
        {
          width: window.innerWidth,
          height: window.innerHeight,
          insetTop: area.top,
          insetBottom: window.innerHeight - area.bottom,
        },
      ),
    );
  };

  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    menuRef.current
      ?.querySelector<HTMLElement>('[role="menuitem"]')
      ?.focus({ preventScroll: true });

    // An own history entry: the system back closes the menu, not the page.
    history.pushState({ ...(history.state ?? {}), popup: true }, '');
    let closedByBack = false;
    const close = () => setPosition(null);
    const onPopState = () => {
      closedByBack = true;
      close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('popstate', onPopState);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
      if (!closedByBack && (history.state as { popup?: boolean })?.popup) {
        history.back();
      }
      trigger?.focus({ preventScroll: true });
    };
  }, [open]);

  const popup =
    position &&
    createPortal(
      <>
        <div
          aria-hidden="true"
          data-popup-backdrop
          className="fixed inset-0 z-[60]"
          onClick={() => setPosition(null)}
        />
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={label}
          className="fixed z-[61] py-2 rounded-xl bg-s3 border border-line2 shadow-float"
          style={{
            left: position.left,
            top: position.top,
            bottom: position.bottom,
            width: MENU_WIDTH,
          }}
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              onClick={() => {
                setPosition(null);
                item.onSelect();
              }}
              className={clsx(
                'w-full h-12 px-4 text-left text-[15px] leading-5 font-medium outline-none focus-visible:bg-thumb',
                item.danger ? 'text-bad' : 'text-fg',
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      </>,
      document.body,
    );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? setPosition(null) : openMenu())}
        className={clsx(
          'w-10 h-10 shrink-0 inline-flex items-center justify-center rounded-[20px] text-fg3',
          open && 'bg-thumb text-fg',
          className,
        )}
      >
        <MoreVertical aria-hidden strokeWidth={2} className="w-5 h-5" />
      </button>
      {popup}
    </>
  );
};
