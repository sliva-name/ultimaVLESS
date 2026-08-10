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
}

type MenuPlacement = {
  top: number;
  left: number;
  width: number;
  openUp: boolean;
  maxHeight: number;
};

function measurePlacement(trigger: HTMLElement): MenuPlacement {
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
          'z-[9999] overflow-y-auto rounded-xl border border-gray-700/70',
          'bg-gray-950/95 backdrop-blur-md shadow-2xl shadow-black/50',
          'py-1.5 animate-[fadeIn_0.12s_ease-out]',
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
                'w-full flex items-start gap-2.5 px-3 py-2 text-left transition-colors',
                isActive && 'bg-white/5',
                isSelected && 'bg-primary/10',
                !isSelected && !isActive && 'hover:bg-white/5',
              )}
            >
              <span
                className={clsx(
                  'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
                  isSelected
                    ? 'border-primary bg-primary/20 text-primary'
                    : 'border-gray-600 text-transparent',
                )}
              >
                <Check className="h-2.5 w-2.5" strokeWidth={3} />
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className={clsx(
                    'block text-sm font-medium leading-snug',
                    isSelected ? 'text-white' : 'text-gray-200',
                  )}
                >
                  {opt.label}
                </span>
                {opt.description ? (
                  <span className="mt-0.5 block text-xs text-gray-500 leading-relaxed">
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
          'group flex min-w-[9.5rem] max-w-[16rem] items-center gap-2 rounded-xl border px-2.5 py-1.5',
          'bg-black/40 text-sm text-white transition-all duration-200',
          'border-gray-600/50 hover:border-gray-500/70',
          'focus:outline-none focus-visible:border-primary/60 focus-visible:ring-2 focus-visible:ring-primary/20',
          'disabled:cursor-not-allowed disabled:opacity-50',
          open && 'border-primary/50 ring-2 ring-primary/15',
          triggerClassName,
        )}
      >
        <span className="min-w-0 flex-1 text-left">
          <span className="block truncate font-medium leading-snug">
            {selected?.label ?? value}
          </span>
          {selected?.description ? (
            <span className="block truncate text-[11px] text-gray-500 leading-tight">
              {selected.description}
            </span>
          ) : null}
        </span>
        <ChevronDown
          className={clsx(
            'h-3.5 w-3.5 shrink-0 text-gray-400 transition-transform duration-200',
            'group-hover:text-gray-300',
            open && 'rotate-180 text-primary',
          )}
        />
      </button>
      {menu}
    </div>
  );
};
