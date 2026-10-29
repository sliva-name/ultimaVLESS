import React, { useState } from 'react';
import clsx from 'clsx';
import { AlertTriangle, Info, Lock, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export type Tone = 'info' | 'ok' | 'warn' | 'bad' | 'violet' | 'teal' | 'plain';

/** Background, foreground and border of a tinted element. */
export const TONES: Record<Tone, string> = {
  info: 'bg-acc-soft text-acc border-acc-line',
  ok: 'bg-ok-soft text-ok border-ok-line',
  warn: 'bg-warn-soft text-warn border-warn-line',
  bad: 'bg-bad-soft text-bad border-bad-line',
  violet: 'bg-violet-soft text-violet border-violet-soft',
  teal: 'bg-teal-soft text-teal border-teal-soft',
  plain: 'bg-s2 text-fg2 border-line2',
};

const TILE_TONES: Record<Tone, string> = {
  info: 'bg-acc-soft text-acc',
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  bad: 'bg-bad-soft text-bad',
  violet: 'bg-violet-soft text-violet',
  teal: 'bg-teal-soft text-teal',
  plain: 'bg-tile text-fg2',
};

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'md' | 'sm';
  icon?: LucideIcon;
}

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'border-acc-fill bg-acc-fill text-white hover:brightness-110',
  secondary: 'border-line2 bg-s1 text-fg hover:bg-s2',
  ghost: 'border-transparent bg-transparent text-fg2 hover:bg-s2 hover:text-fg',
  danger: 'border-bad-line bg-transparent text-bad hover:bg-bad-soft',
};

/** Regular weight everywhere: 32 px in panels, 28 px inside rows. */
export const Button: React.FC<ButtonProps> = ({
  variant = 'secondary',
  size = 'md',
  icon: Icon,
  className,
  children,
  type = 'button',
  ...rest
}) => (
  <button
    type={type}
    {...rest}
    className={clsx(
      'shrink-0 inline-flex items-center justify-center gap-1.5 rounded-md border font-normal whitespace-nowrap',
      'transition-[background-color,color,filter] duration-150',
      'disabled:opacity-45 disabled:pointer-events-none',
      size === 'md'
        ? 'h-8 px-3 text-[13px] leading-4'
        : 'h-7 px-2.5 text-xs leading-4',
      BUTTON_VARIANTS[variant],
      className,
    )}
  >
    {Icon && (
      <Icon
        aria-hidden
        strokeWidth={1.75}
        className={size === 'md' ? 'w-4 h-4' : 'w-3.5 h-3.5'}
      />
    )}
    {children}
  </button>
);

/** Square 28 px icon button; the label goes to the tooltip and aria-label. */
export const IconButton: React.FC<
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    icon: LucideIcon;
    label: string;
    size?: 24 | 28;
  }
> = ({ icon: Icon, label, size = 28, className, ...rest }) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    {...rest}
    className={clsx(
      'shrink-0 inline-flex items-center justify-center rounded-md text-fg2 hover:bg-s3 hover:text-fg',
      'transition-colors duration-150 disabled:text-dim disabled:pointer-events-none',
      size === 28 ? 'w-7 h-7' : 'w-6 h-6',
      className,
    )}
  >
    <Icon
      aria-hidden
      strokeWidth={size === 28 ? 1.75 : 2}
      className={size === 28 ? 'w-4 h-4' : 'w-3.5 h-3.5'}
    />
  </button>
);

// ---------------------------------------------------------------------------
// Page frame
// ---------------------------------------------------------------------------

interface PageProps {
  title: string;
  lead?: string;
  actions?: React.ReactNode;
  /** Pinned under the header: the read-only notice. */
  banner?: React.ReactNode;
  /** Pinned to the bottom: the save bar. */
  footer?: React.ReactNode;
  children: React.ReactNode;
}

/** A settings-style page: a 640 px column that scrolls, header on top. */
export const Page: React.FC<PageProps> = ({
  title,
  lead,
  actions,
  banner,
  footer,
  children,
}) => (
  <main className="flex-1 min-w-0 min-h-0 flex flex-col bg-canvas">
    <div className="flex-1 min-h-0 overflow-y-auto px-8 pt-6 pb-8">
      <div className="page-in max-w-[640px] mx-auto flex flex-col gap-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex flex-col gap-1">
            <h1 className="m-0 text-[22px] leading-7 font-semibold tracking-[-0.02em]">
              {title}
            </h1>
            {lead && (
              <p className="m-0 text-[13px] leading-5 text-fg2">{lead}</p>
            )}
          </div>
          {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
        </div>
        {banner}
        {children}
      </div>
    </div>
    {footer}
  </main>
);

interface PanelProps {
  title?: string;
  note?: string;
  desc?: React.ReactNode;
  foot?: React.ReactNode;
  /** Read-only while a session runs. */
  locked?: boolean;
  children?: React.ReactNode;
}

export const Panel: React.FC<PanelProps> = ({
  title,
  note,
  desc,
  foot,
  locked = false,
  children,
}) => (
  <section
    aria-label={title}
    className={clsx(
      'flex flex-col gap-2 transition-opacity duration-200',
      locked && 'opacity-55',
    )}
  >
    {title && (
      <div className="min-h-4 flex items-center justify-between gap-3">
        <h2 className="m-0 text-[11px] leading-4 font-semibold tracking-[0.06em] uppercase text-fg3">
          {title}
        </h2>
        {note && (
          <span className="text-xs leading-4 text-fg3 text-right">{note}</span>
        )}
      </div>
    )}
    {desc && <p className="m-0 text-xs leading-[18px] text-fg2">{desc}</p>}
    {locked ? (
      <fieldset disabled aria-disabled className="contents">
        {children}
      </fieldset>
    ) : (
      children
    )}
    {foot && <div className="flex flex-col gap-1.5">{foot}</div>}
  </section>
);

export const Foot: React.FC<{ children: React.ReactNode; tone?: 'warn' }> = ({
  children,
  tone,
}) => (
  <p
    className={clsx(
      'm-0 text-xs leading-[18px]',
      tone === 'warn' ? 'text-warn' : 'text-fg3',
    )}
  >
    {children}
  </p>
);

export const ErrorText: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => (
  <p role="alert" className="m-0 text-xs leading-[18px] text-warn break-words">
    {children}
  </p>
);

export const Notice: React.FC<{ tone?: Tone; children: React.ReactNode }> = ({
  tone = 'info',
  children,
}) => {
  const Icon = tone === 'warn' || tone === 'bad' ? AlertTriangle : Info;
  return (
    <div
      className={clsx(
        'flex items-start gap-2.5 py-2.5 px-3 rounded-lg border',
        TONES[tone],
      )}
    >
      <Icon aria-hidden strokeWidth={1.75} className="w-4 h-4 shrink-0 mt-px" />
      <span className="min-w-0 text-xs leading-[18px] text-fg2 break-words">
        {children}
      </span>
    </div>
  );
};

/** Settings that cannot change under a live session. */
export const LockBanner: React.FC<{
  text: string;
  onDisconnect: () => void;
  disconnectDisabled?: boolean;
}> = ({ text, onDisconnect, disconnectDisabled }) => {
  const { t } = useTranslation();
  return (
    <div
      role="status"
      className="flex items-center gap-2.5 py-2 pr-2 pl-3 rounded-lg bg-ok-soft border border-ok-line"
    >
      <Lock
        aria-hidden
        strokeWidth={1.75}
        className="w-4 h-4 shrink-0 text-ok"
      />
      <span className="flex-1 min-w-0 text-xs leading-4 text-fg">{text}</span>
      <button
        type="button"
        onClick={onDisconnect}
        disabled={disconnectDisabled}
        className="shrink-0 h-7 px-2.5 rounded-md border border-ok-line bg-transparent text-fg text-xs leading-4 font-normal hover:bg-ok-soft disabled:opacity-50"
      >
        {t('shell.disconnect')}
      </button>
    </div>
  );
};

/** Unsaved network settings: count, discard and save. */
export const SaveBar: React.FC<{
  changes: number;
  saving: boolean;
  onDiscard: () => void;
  onSave: () => void;
}> = ({ changes, saving, onDiscard, onSave }) => {
  const { t } = useTranslation();
  return (
    <div className="h-14 shrink-0 flex items-center gap-2 px-8 border-t border-line bg-s1">
      <span
        aria-hidden="true"
        className="w-1.5 h-1.5 mr-0.5 shrink-0 rounded-full bg-acc"
      />
      <span className="flex-1 min-w-0 text-[13px] leading-[18px] text-fg2">
        <span className="font-semibold text-fg">
          {t('count.changes', { count: changes })}
        </span>
        {' · '}
        {t('pages.changesHint')}
      </span>
      <Button onClick={onDiscard} disabled={saving}>
        {t('pages.discard')}
      </Button>
      <Button variant="primary" onClick={onSave} disabled={saving}>
        {saving ? t('settings.sources.saving') : t('settings.network.savePerf')}
      </Button>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export const RowGroup: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => (
  <div className="rounded-xl bg-s1 border border-line shadow-panel overflow-hidden divide-y divide-line">
    {children}
  </div>
);

interface TileProps {
  icon?: LucideIcon;
  tone?: Tone;
  letter?: string;
  image?: string | null;
  dashed?: boolean;
}

/** 32 px square in front of a row. */
export const Tile: React.FC<TileProps> = ({
  icon: Icon,
  tone,
  letter,
  image,
  dashed,
}) => (
  <span
    aria-hidden="true"
    className={clsx(
      'w-8 h-8 shrink-0 rounded-lg flex items-center justify-center overflow-hidden text-[13px] leading-4 font-bold',
      dashed
        ? 'border-[1.5px] border-dashed border-line2 text-fg2'
        : tone
          ? TILE_TONES[tone]
          : 'bg-tile text-fg2',
    )}
  >
    {image ? (
      <img
        src={image}
        alt=""
        draggable={false}
        className="w-5 h-5 object-contain"
      />
    ) : Icon ? (
      <Icon strokeWidth={1.75} className="w-4 h-4" />
    ) : (
      letter
    )}
  </span>
);

interface RowProps {
  tile?: React.ReactNode;
  /** Leading radio mark (choice lists). */
  radio?: boolean;
  label: React.ReactNode;
  labelMono?: boolean;
  hint?: React.ReactNode;
  hintMono?: boolean;
  hintTone?: 'warn' | 'fg2';
  trailing?: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  role?: string;
  ariaChecked?: boolean;
  /** Extra content under the label, full width (inputs of a custom DNS). */
  below?: React.ReactNode;
}

export const Row: React.FC<RowProps> = ({
  tile,
  radio,
  label,
  labelMono,
  hint,
  hintMono,
  hintTone,
  trailing,
  onClick,
  disabled,
  role,
  ariaChecked,
  below,
}) => {
  const body = (
    <>
      {radio !== undefined && <RadioMark on={radio} />}
      {tile}
      <span className="flex-1 min-w-0 flex flex-col">
        <span
          className={clsx(
            'text-[13px] leading-5 font-medium break-words',
            labelMono && 'font-mono',
          )}
        >
          {label}
        </span>
        {hint && (
          <span
            className={clsx(
              'mt-0.5 leading-[18px] break-words',
              hintMono ? 'font-mono text-[11px]' : 'text-xs',
              hintTone === 'warn'
                ? 'text-warn'
                : hintTone === 'fg2'
                  ? 'text-fg2'
                  : 'text-fg3',
            )}
          >
            {hint}
          </span>
        )}
        {below}
      </span>
      {trailing}
    </>
  );
  const className = clsx(
    'w-full min-h-[52px] flex items-center gap-3 px-4 py-2.5 text-left',
    disabled && 'opacity-55',
  );
  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      role={role}
      aria-checked={ariaChecked}
      className={clsx(className, 'hover:bg-s2 transition-colors duration-150')}
    >
      {body}
    </button>
  ) : (
    <div className={className}>{body}</div>
  );
};

export const StatusPill: React.FC<{
  tone: Tone;
  children: React.ReactNode;
}> = ({ tone, children }) => (
  <span
    className={clsx(
      'shrink-0 h-[22px] inline-flex items-center gap-1.5 px-2 rounded-md border text-xs leading-4 font-medium whitespace-nowrap',
      TONES[tone],
    )}
  >
    <span className="w-1.5 h-1.5 rounded-full bg-current shrink-0" />
    {children}
  </span>
);

export const RadioMark: React.FC<{ on: boolean }> = ({ on }) => (
  <span
    aria-hidden="true"
    className={clsx(
      'block w-4 h-4 shrink-0 rounded-full box-border',
      on ? 'border-[5px] border-acc-fill' : 'border-[1.5px] border-line2',
    )}
  />
);

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

interface NumberFieldProps {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}

/** Typed freely, clamped to the range when the field is left. */
export const NumberField: React.FC<NumberFieldProps> = ({
  label,
  value,
  min,
  max,
  onChange,
}) => {
  const [draft, setDraft] = useState(String(value));
  // A reset or a discard replaces the value from outside.
  const [shown, setShown] = useState(value);
  if (shown !== value) {
    setShown(value);
    setDraft(String(value));
  }
  const commit = () => {
    const parsed = parseInt(draft, 10);
    const next = Math.max(
      min,
      Math.min(max, Number.isNaN(parsed) ? value : parsed),
    );
    setDraft(String(next));
    if (next !== value) onChange(next);
  };
  return (
    <input
      type="text"
      inputMode="numeric"
      value={draft}
      aria-label={label}
      onChange={(e) => setDraft(e.target.value.replace(/[^\d]/g, ''))}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
      className="shrink-0 w-20 h-8 px-2.5 rounded-lg border border-line2 bg-s2 text-fg text-[13px] leading-5 text-right tabular-nums outline-none focus:border-acc-fill"
    />
  );
};

export const TextField: React.FC<
  React.InputHTMLAttributes<HTMLInputElement> & { mono?: boolean }
> = ({ mono, className, ...rest }) => (
  <input
    type="text"
    {...rest}
    className={clsx(
      'min-w-0 h-8 px-3 rounded-lg border border-line2 bg-s2 text-fg text-[13px] leading-5 outline-none placeholder:text-fg3 focus:border-acc-fill disabled:opacity-55',
      mono && 'font-mono text-xs',
      className,
    )}
  />
);

export interface ChoiceOption<T extends string> {
  value: T;
  label: string;
  desc: string;
  /** Two-color swatch above the label (theme cards). */
  preview?: [string, string];
}

/** Radio cards: network mode, ping method, theme, language. */
export function ChoiceCards<T extends string>({
  label,
  options,
  value,
  onChange,
  columns = 2,
  disabled = false,
  isDisabled,
}: {
  label: string;
  options: ChoiceOption<T>[];
  value: T;
  onChange: (value: T) => void;
  columns?: 2 | 3;
  disabled?: boolean;
  isDisabled?: (value: T) => boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={clsx(
        'grid gap-2',
        columns === 3 ? 'grid-cols-3' : 'grid-cols-2',
      )}
    >
      {options.map((option) => {
        const on = option.value === value;
        const off = disabled || (isDisabled?.(option.value) ?? false);
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={off}
            onClick={() => onChange(option.value)}
            className={clsx(
              'flex flex-col gap-1.5 pt-3.5 px-4 pb-4 rounded-xl border text-left shadow-panel',
              'transition-colors duration-150 disabled:opacity-55',
              on
                ? 'border-acc-line bg-acc-soft'
                : 'border-line bg-s1 hover:bg-s2',
            )}
          >
            {option.preview && (
              <span
                aria-hidden="true"
                className="h-14 mb-1.5 rounded-md flex overflow-hidden shadow-[inset_0_0_0_1px_var(--color-line)]"
              >
                <span
                  className="flex-1"
                  style={{ background: option.preview[0] }}
                />
                <span
                  className="flex-1"
                  style={{ background: option.preview[1] }}
                />
              </span>
            )}
            <span className="flex items-start gap-2.5">
              <span className="mt-0.5 shrink-0">
                <RadioMark on={on} />
              </span>
              <span className="min-w-0 text-[13px] leading-5 font-semibold">
                {option.label}
              </span>
            </span>
            <span className="pl-[26px] text-xs leading-[18px] text-fg3">
              {option.desc}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Radio rows in a group: DNS presets, routing mode. */
export function RadioRows<T extends string>({
  label,
  options,
  value,
  onChange,
  extra,
}: {
  label: string;
  options: ChoiceOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Shown under the chosen row (custom DNS fields). */
  extra?: Partial<Record<T, React.ReactNode>>;
}) {
  return (
    <div role="radiogroup" aria-label={label}>
      <RowGroup>
        {options.map((option) => (
          <React.Fragment key={option.value}>
            <Row
              radio={option.value === value}
              role="radio"
              ariaChecked={option.value === value}
              label={option.label}
              hint={option.desc}
              onClick={() => onChange(option.value)}
            />
            {option.value === value && extra?.[option.value]}
          </React.Fragment>
        ))}
      </RowGroup>
    </div>
  );
}
