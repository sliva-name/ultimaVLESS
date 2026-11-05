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
import { AppWindow, ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { AppOption } from '@/shared/appRouting';
import { measurePlacement } from '@/renderer/components/ui';
import type { MenuPlacement } from '@/renderer/components/ui';

/** The file's own icon, or a generic window glyph when it is unknown. */
export const AppIcon: React.FC<{
  icon: string | null | undefined;
  className?: string;
}> = ({ icon, className }) =>
  icon ? (
    <img
      src={icon}
      alt=""
      aria-hidden="true"
      draggable={false}
      className={clsx('shrink-0 object-contain', className)}
    />
  ) : (
    <AppWindow
      aria-hidden="true"
      strokeWidth={1.75}
      className={clsx('shrink-0 text-fg3', className)}
    />
  );

interface AppPickerProps {
  value: string;
  onValueChange: (value: string) => void;
  options: readonly AppOption[];
  /** Names already in the list; they are not offered again. */
  exclude: readonly string[];
  onPick: (name: string) => void;
  /** Enter with nothing highlighted: add the typed text as is. */
  onSubmit: () => void;
  /** Called each time the list opens, so the caller can refresh it. */
  onOpen?: () => void;
  loading?: boolean;
  disabled?: boolean;
  ariaLabel: string;
  placeholder: string;
}

/**
 * Combobox over the running programs: typing filters by file name and
 * description, the list scrolls, and arrows / Enter / Escape work as in a
 * native select. Free text stays possible for programs that are not running.
 */
export const AppPicker: React.FC<AppPickerProps> = ({
  value,
  onValueChange,
  options,
  exclude,
  onPick,
  onSubmit,
  onOpen,
  loading = false,
  disabled = false,
  ariaLabel,
  placeholder,
}) => {
  const { t } = useTranslation();
  const listboxId = useId();
  const anchorRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<MenuPlacement | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);

  const query = value.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      options.filter(
        (option) =>
          !exclude.includes(option.name) &&
          (query.length === 0 ||
            option.name.toLowerCase().includes(query) ||
            (option.description?.toLowerCase().includes(query) ?? false)),
      ),
    [exclude, options, query],
  );
  const active = activeIndex < filtered.length ? activeIndex : -1;

  const openMenu = useCallback(() => {
    if (disabled || !anchorRef.current) return;
    setPlacement(measurePlacement(anchorRef.current));
    if (!open) onOpen?.();
    setOpen(true);
  }, [disabled, onOpen, open]);

  useEffect(() => {
    if (!open) return;
    const reposition = () => {
      if (anchorRef.current) setPlacement(measurePlacement(anchorRef.current));
    };
    window.addEventListener('resize', reposition);
    // Capture scroll from nested overflow containers (settings modal).
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open || active < 0) return;
    menuRef.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView?.({ block: 'nearest' });
  }, [active, open]);

  const pick = useCallback(
    (name: string) => {
      onPick(name);
      setActiveIndex(-1);
    },
    [onPick],
  );

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        openMenu();
        setActiveIndex(Math.min(filtered.length - 1, active + 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        setActiveIndex(Math.max(0, active - 1));
        break;
      case 'Enter':
        event.preventDefault();
        if (open && active >= 0) pick(filtered[active].name);
        else onSubmit();
        break;
      case 'Escape':
        if (!open) return;
        event.preventDefault();
        setOpen(false);
        break;
    }
  };

  const emptyText = loading
    ? t('settings.network.routingAppsLoading')
    : query.length > 0
      ? t('settings.network.routingAppsNoMatches')
      : t('settings.network.routingAppsNoRunning');

  const menu =
    open &&
    placement &&
    createPortal(
      <div
        ref={menuRef}
        id={listboxId}
        role="listbox"
        aria-label={ariaLabel}
        // Keeps focus (and the typed text) in the input, scrollbar included.
        onMouseDown={(event) => event.preventDefault()}
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
          'z-[9999] overflow-y-auto overscroll-contain rounded-xl border border-line2',
          'bg-s3 shadow-float p-1 menu-in',
        )}
      >
        {filtered.length === 0 ? (
          <p className="m-0 px-2.5 py-2 text-xs leading-4 text-fg3">
            {emptyText}
          </p>
        ) : (
          filtered.map((option, index) => (
            <React.Fragment key={option.name}>
              {option.system && !filtered[index - 1]?.system && (
                <div
                  role="presentation"
                  className="px-2.5 pt-2 pb-1 text-[11px] leading-4 font-semibold uppercase tracking-[0.06em] text-fg3"
                >
                  {t('settings.network.routingAppsSystemGroup')}
                </div>
              )}
              <div
                id={`${listboxId}-${index}`}
                data-index={index}
                role="option"
                aria-selected={index === active}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => pick(option.name)}
                className={clsx(
                  'flex cursor-pointer items-center gap-2.5 px-2.5 py-1.5 rounded-md transition-colors',
                  index === active && 'bg-thumb',
                )}
              >
                <AppIcon icon={option.icon} className="h-5 w-5" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] leading-5 text-fg">
                    {option.description ?? option.name}
                  </span>
                  {option.description && (
                    <span className="block truncate font-mono text-[11px] leading-4 text-fg3">
                      {option.name}
                    </span>
                  )}
                </span>
              </div>
            </React.Fragment>
          ))
        )}
      </div>,
      document.body,
    );

  return (
    <div ref={anchorRef} className="relative flex-1 min-w-40">
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={
          open && active >= 0 ? `${listboxId}-${active}` : undefined
        }
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(event) => {
          onValueChange(event.target.value);
          // Typing highlights the best match, so Enter picks it.
          setActiveIndex(event.target.value.trim().length > 0 ? 0 : -1);
          openMenu();
        }}
        onClick={openMenu}
        onBlur={() => setOpen(false)}
        onKeyDown={handleKeyDown}
        className="w-full h-8 box-border rounded-lg border border-line2 bg-s2 pl-3 pr-8 text-[13px] leading-5 text-fg placeholder:text-fg3 outline-none focus:border-acc-fill disabled:opacity-55"
      />
      <button
        type="button"
        tabIndex={-1}
        disabled={disabled}
        aria-label={t('settings.network.routingAppsShowList')}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          if (open) {
            setOpen(false);
            return;
          }
          inputRef.current?.focus();
          openMenu();
        }}
        className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-fg3 hover:text-fg disabled:opacity-40"
      >
        <ChevronDown
          strokeWidth={1.75}
          className={clsx(
            'h-4 w-4 transition-transform duration-200',
            open && 'rotate-180',
          )}
        />
      </button>
      {menu}
    </div>
  );
};
