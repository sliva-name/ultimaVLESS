import React, {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { Check, ChevronDown } from 'lucide-react';

export type SelectOption = {
  value: string;
  label: string;
  description?: string;
};

export interface SelectProps {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
  /** Min width of the trigger; dropdown matches trigger width by default. */
  triggerClassName?: string;
  /** Repeats the chosen option's description in the trigger. */
  showDescription?: boolean;
}

export type MenuPlacement = {
  top: number;
  left: number;
  width: number;
  openUp: boolean;
  maxHeight: number;
};

/** Fixed-position placement for a popup menu anchored to `trigger`. */
export function measurePlacement(trigger: HTMLElement): MenuPlacement {
  const rect = trigger.getBoundingClientRect();
  const viewportPad = 8;
  const preferredMax = 280;
  const spaceBelow = window.innerHeight - rect.bottom - viewportPad;
  const spaceAbove = rect.top - viewportPad;
  const openUp = spaceBelow < 160 && spaceAbove > spaceBelow;
  const maxHeight = Math.min(
    preferredMax,
    Math.max(120, openUp ? spaceAbove : spaceBelow),
  );
  return {
    top: openUp ? rect.top : rect.bottom + 6,
    left: rect.left,
    width: Math.max(rect.width, 180),
    openUp,
    maxHeight,
  };
}

export const Select: React.FC<SelectProps> = ({
  value,
  options,
  onChange,
  disabled = false,
  ariaLabel,
  className,
  triggerClassName,
  showDescription = false,
}) => {
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<MenuPlacement | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const selected = useMemo(
    () => options.find((opt) => opt.value === value) ?? options[0],
    [options, value],
  );

  const selectedIndex = useMemo(
    () => options.findIndex((opt) => opt.value === value),
    [options, value],
  );

  const closeMenu = useCallback(() => {
    setOpen(false);
  }, []);

  const openMenu = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
    setPlacement(measurePlacement(trigger));
    setOpen(true);
  }, [selectedIndex]);

  const toggleMenu = useCallback(() => {
    if (disabled) return;
    if (open) {
      closeMenu();
      return;
    }
    openMenu();
  }, [closeMenu, disabled, open, openMenu]);

  useEffect(() => {
    if (!open) return;

    const onScrollOrResize = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      setPlacement(measurePlacement(trigger));
    };
    window.addEventListener('resize', onScrollOrResize);
    // Capture scroll from nested overflow containers (settings modal).
    window.addEventListener('scroll', onScrollOrResize, true);

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      closeMenu();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeMenu();
        triggerRef.current?.focus();
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((idx) =>
          Math.min(options.length - 1, Math.max(0, idx) + 1),
        );
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((idx) => Math.max(0, (idx < 0 ? 0 : idx) - 1));
        return;
      }
      if (event.key === 'Enter' || event.key === ' ') {
        if (activeIndex < 0 || activeIndex >= options.length) return;
        event.preventDefault();
        onChange(options[activeIndex].value);
        closeMenu();
        triggerRef.current?.focus();
      }
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('resize', onScrollOrResize);
      window.removeEventListener('scroll', onScrollOrResize, true);
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, options, activeIndex, onChange, closeMenu]);

  const handleSelect = useCallback(
    (next: string) => {
      onChange(next);
      closeMenu();
      triggerRef.current?.focus();
    },
    [closeMenu, onChange],
  );

  const menu =
    open &&
    placement &&
    createPortal(
      <div
        ref={menuRef}
        id={listboxId}
        role="listbox"
        aria-label={ariaLabel}
        style={{
          position: 'fixed',
          top: placement.openUp ? undefined : placement.top,
          bottom: placement.openUp
            ? window.innerHeight - placement.top + 6
            : undefined,
          left: placement.left,
          width: placement.width,
          maxHeight: placement.maxHeight,
        }}
        className={clsx(
          'z-[9999] overflow-y-auto rounded-xl border border-line2 bg-s3 shadow-float',
          'p-1 menu-in',
        )}
      >
        {options.map((opt, index) => {
          const isSelected = opt.value === value;
          const isActive = index === activeIndex;
          return (
            <button
              key={opt.value}
              type="button"
              role="option"
              aria-selected={isSelected}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => handleSelect(opt.value)}
              className={clsx(
                'w-full flex items-start gap-2.5 px-2.5 py-1.5 rounded-md text-left text-fg transition-colors',
                isActive && 'bg-thumb',
              )}
            >
              <Check
                aria-hidden
                strokeWidth={2}
                className={clsx(
                  'mt-0.5 h-4 w-4 shrink-0',
                  isSelected ? 'text-acc' : 'text-transparent',
                )}
              />
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] leading-5">{opt.label}</span>
                {opt.description ? (
                  <span className="block text-xs leading-4 text-fg3">
                    {opt.description}
                  </span>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>,
      document.body,
    );

  return (
    <div ref={rootRef} className={clsx('relative shrink-0', className)}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        onClick={toggleMenu}
        className={clsx(
          'group flex w-56 h-8 items-center gap-2 rounded-lg border border-line2 bg-s2 pl-3 pr-2',
          'text-fg text-left transition-colors duration-150 hover:border-fg3',
          'disabled:cursor-not-allowed disabled:opacity-50',
          open && 'border-acc-fill',
          triggerClassName,
        )}
      >
        <span className="min-w-0 flex-1 truncate text-[13px] leading-5">
          {selected?.label ?? value}
          {showDescription && selected?.description ? (
            <span className="text-fg3"> · {selected.description}</span>
          ) : null}
        </span>
        <ChevronDown
          aria-hidden
          strokeWidth={1.75}
          className={clsx(
            'h-4 w-4 shrink-0 text-fg3 transition-transform duration-200',
            open && 'rotate-180',
          )}
        />
      </button>
      {menu}
    </div>
  );
};
