import React, { useState } from 'react';
import clsx from 'clsx';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  Info,
  Lock,
  Undo2,
  X,
  type LucideIcon,
} from 'lucide-react';
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
// Page frame
// ---------------------------------------------------------------------------

interface SubHeaderProps {
  title: string;
  sub?: string;
  /** Full-screen picker: a close cross instead of the back arrow. */
  modal?: boolean;
  onBack: () => void;
  action?: React.ReactNode;
}

export const SubHeader: React.FC<SubHeaderProps> = ({
  title,
  sub,
  modal = false,
  onBack,
  action,
}) => {
  const { t } = useTranslation();
  const Icon = modal ? X : ArrowLeft;
  return (
    <header className="h-16 shrink-0 flex items-center gap-1 pl-1 pr-2">
      <button
        type="button"
        onClick={onBack}
        aria-label={t(modal ? 'mobile.close' : 'mobile.back')}
        className="w-12 h-12 inline-flex items-center justify-center rounded-3xl text-fg"
      >
        <Icon aria-hidden strokeWidth={2} className="w-6 h-6" />
      </button>
      <div className="flex-1 min-w-0 flex flex-col">
        <h1 className="m-0 text-xl leading-[26px] font-semibold tracking-[-0.01em] truncate">
          {title}
        </h1>
        {sub && (
          <span className="text-[13px] leading-[18px] text-fg3 truncate">
            {sub}
          </span>
        )}
      </div>
      {action}
    </header>
  );
};

/** Scrolling body of a settings screen. */
export const PageBody: React.FC<{
  lead?: string;
  children: React.ReactNode;
}> = ({ lead, children }) => (
  <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 pt-1 pb-6 flex flex-col gap-6">
    {lead && <p className="m-0 text-sm leading-5 text-fg2">{lead}</p>}
    {children}
  </div>
);

interface PanelProps {
  title?: string;
  note?: string;
  desc?: string;
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
      <div className="min-h-4 flex items-center justify-between gap-3 px-1">
        <h2 className="m-0 text-xs leading-4 font-semibold tracking-[0.06em] uppercase text-fg3">
          {title}
        </h2>
        {note && (
          <span className="text-xs leading-4 text-fg3 text-right">{note}</span>
        )}
      </div>
    )}
    {desc && (
      <p className="m-0 px-1 text-[13px] leading-[18px] text-fg2">{desc}</p>
    )}
    {locked ? (
      <fieldset disabled aria-disabled className="contents">
        {children}
      </fieldset>
    ) : (
      children
    )}
    {foot && <div className="flex flex-col gap-1.5 px-1">{foot}</div>}
  </section>
);

export const Foot: React.FC<{ children: React.ReactNode; tone?: 'warn' }> = ({
  children,
  tone,
}) => (
  <p
    className={clsx(
      'm-0 text-[13px] leading-[18px]',
      tone === 'warn' ? 'text-warn' : 'text-fg3',
    )}
  >
    {children}
  </p>
);

export const ErrorText: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => (
  <p role="alert" className="m-0 px-1 text-[13px] leading-[18px] text-warn">
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
        'flex items-start gap-2.5 py-3 px-3.5 rounded-xl border',
        TONES[tone],
      )}
    >
      <Icon
        aria-hidden
        strokeWidth={1.75}
        className="w-[18px] h-[18px] shrink-0"
      />
      <span className="text-[13px] leading-[18px] text-fg2 break-words min-w-0">
        {children}
      </span>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export const RowGroup: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => (
  <div className="rounded-2xl bg-s1 border border-line overflow-hidden divide-y divide-line">
    {children}
  </div>
);

interface TileProps {
  icon?: LucideIcon;
  tone?: Tone;
  letter?: string;
  image?: string | null;
}

export const Tile: React.FC<TileProps> = ({
  icon: Icon,
  tone,
  letter,
  image,
}) => (
  <span
    aria-hidden="true"
    className={clsx(
      'w-10 h-10 shrink-0 rounded-xl flex items-center justify-center overflow-hidden text-base leading-5 font-bold',
      tone ? TILE_TONES[tone] : 'bg-tile text-fg2',
    )}
  >
    {image ? (
      <img
        src={image}
        alt=""
        draggable={false}
        className="w-7 h-7 object-contain"
      />
    ) : Icon ? (
      <Icon strokeWidth={1.75} className="w-5 h-5" />
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
  hint?: React.ReactNode;
  hintMono?: boolean;
  hintTone?: 'warn';
  /** Status chip before the hint. */
  status?: { text: string; tone: Tone };
  /** Value under the label (select rows). */
  value?: string;
  trailing?: React.ReactNode;
  onClick?: () => void;
  /** Labels that may wrap instead of being cut. */
  wrap?: boolean;
  disabled?: boolean;
  role?: string;
  ariaChecked?: boolean;
  ariaLabel?: string;
}

export const Row: React.FC<RowProps> = ({
  tile,
  radio,
  label,
  hint,
  hintMono,
  hintTone,
  status,
  value,
  trailing,
  onClick,
  wrap,
  disabled,
  role,
  ariaChecked,
  ariaLabel,
}) => {
  const body = (
    <>
      {radio !== undefined && <RadioMark on={radio} />}
      {tile}
      <span className="flex-1 min-w-0 flex flex-col">
        <span
          className={clsx(
            'text-[15px] leading-5 font-medium',
            wrap ? 'break-words' : 'truncate',
          )}
        >
          {label}
        </span>
        {value !== undefined && (
          <span className="mt-0.5 text-sm leading-5 font-medium text-acc truncate">
            {value}
          </span>
        )}
        {status && (
          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            <StatusChip tone={status.tone}>{status.text}</StatusChip>
            {hint && (
              <span className="text-[13px] leading-[18px] text-fg3">
                {hint}
              </span>
            )}
          </span>
        )}
        {hint && !status && (
          <span
            className={clsx(
              'mt-0.5 leading-[18px] break-words',
              hintMono ? 'font-mono text-xs' : 'text-[13px]',
              hintTone === 'warn' ? 'text-warn' : 'text-fg3',
            )}
          >
            {hint}
          </span>
        )}
      </span>
      {trailing}
    </>
  );
  const className = clsx(
    'w-full min-h-14 flex items-center gap-3.5 px-4 py-3 text-left',
    disabled && 'opacity-55',
  );
  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      role={role}
      aria-checked={ariaChecked}
      aria-label={ariaLabel}
      className={className}
    >
      {body}
    </button>
  ) : (
    <div className={className}>{body}</div>
  );
};

export const NavChevron: React.FC = () => (
  <ChevronRight
    aria-hidden
    strokeWidth={2}
    className="w-5 h-5 shrink-0 text-fg3"
  />
);

export const StatusChip: React.FC<{
  tone: Tone;
  children: React.ReactNode;
}> = ({ tone, children }) => (
  <span
    className={clsx(
      'h-[22px] inline-flex items-center gap-[5px] px-2 rounded-md border text-xs leading-4 font-medium whitespace-nowrap',
      TONES[tone],
    )}
  >
    <span className="w-1.5 h-1.5 rounded-full bg-current" />
    {children}
  </span>
);

export const Pill: React.FC<{ tone: Tone; children: React.ReactNode }> = ({
  tone,
  children,
}) => (
  <span
    className={clsx(
      'shrink-0 h-[26px] inline-flex items-center gap-1.5 px-2.5 rounded-lg border text-[13px] leading-4 font-medium whitespace-nowrap',
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
      'w-5 h-5 shrink-0 rounded-full',
      on ? 'border-[6px] border-acc-fill' : 'border-2 border-fg3',
    )}
  />
);

export const CheckMark: React.FC<{ on: boolean }> = ({ on }) => (
  <span
    aria-hidden="true"
    className={clsx(
      'w-[22px] h-[22px] shrink-0 rounded-md flex items-center justify-center text-white transition-colors duration-150',
      on ? 'bg-acc-fill' : 'border-2 border-fg3',
    )}
  >
    {on && <Check strokeWidth={3} className="w-4 h-4" />}
  </span>
);

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}

/** Material 3 switch. */
export const Switch: React.FC<SwitchProps> = ({
  checked,
  onChange,
  label,
  disabled,
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    disabled={disabled}
    onClick={() => onChange(!checked)}
    className={clsx(
      'w-[52px] h-8 shrink-0 px-1 box-border border-2 rounded-2xl flex items-center transition-colors duration-150',
      checked
        ? 'bg-acc-fill border-acc-fill justify-end'
        : 'bg-s3 border-fg3 justify-start',
    )}
  >
    <span
      className={clsx(
        'rounded-full',
        checked ? 'w-6 h-6 bg-white' : 'w-4 h-4 bg-fg3',
      )}
    />
  </button>
);

export const SwitchRow: React.FC<{
  label: string;
  hint: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}> = ({ label, hint, checked, onChange }) => (
  <Row
    label={label}
    hint={hint}
    trailing={<Switch checked={checked} onChange={onChange} label={label} />}
  />
);

interface NumberRowProps {
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}

/** Typed freely, clamped to the range when the field is left. */
export const NumberRow: React.FC<NumberRowProps> = ({
  label,
  hint,
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
    <Row
      label={label}
      hint={hint}
      trailing={
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
          className="shrink-0 w-[76px] h-10 px-3 rounded-[10px] border border-line2 bg-s2 text-fg text-[15px] leading-5 text-right tabular-nums outline-none focus:border-acc-fill"
        />
      }
    />
  );
};

export interface SelectOption {
  value: string;
  label: string;
}

/** The value under the label; the system picker opens on tap. */
export const SelectRow: React.FC<{
  label: string;
  hint: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
}> = ({ label, hint, value, options, onChange }) => (
  <div className="relative">
    <Row
      label={label}
      value={options.find((option) => option.value === value)?.label ?? value}
      hint={hint}
      trailing={
        <ChevronDown
          aria-hidden
          strokeWidth={2}
          className="w-5 h-5 shrink-0 text-fg3"
        />
      }
    />
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="absolute inset-0 w-full h-full opacity-0"
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  </div>
);

export interface ChoiceOption<T extends string> {
  value: T;
  label: string;
  desc: string;
}

/** Radio cards: network mode, ping method. */
export function ChoiceCards<T extends string>({
  label,
  options,
  value,
  onChange,
  columns = 1,
  disabled = false,
}: {
  label: string;
  options: ChoiceOption<T>[];
  value: T;
  onChange: (value: T) => void;
  columns?: 1 | 2;
  disabled?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={clsx(
        'grid gap-2',
        columns === 2 ? 'grid-cols-2' : 'grid-cols-1',
      )}
    >
      {options.map((option) => {
        const on = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={clsx(
              'flex flex-col gap-1.5 pt-3.5 px-4 pb-4 rounded-2xl border text-left',
              on ? 'border-acc-line bg-acc-soft' : 'border-line bg-s1',
            )}
          >
            <span className="flex items-start gap-2.5">
              <RadioMark on={on} />
              <span className="min-w-0 text-[15px] leading-5 font-semibold">
                {option.label}
              </span>
            </span>
            <span className="pl-[30px] text-[13px] leading-[18px] text-fg3">
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
}: {
  label: string;
  options: ChoiceOption<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label}>
      <RowGroup>
        {options.map((option) => (
          <Row
            key={option.value}
            radio={option.value === value}
            role="radio"
            ariaChecked={option.value === value}
            label={option.label}
            hint={option.desc}
            onClick={() => onChange(option.value)}
          />
        ))}
      </RowGroup>
    </div>
  );
}

export const WideButton: React.FC<{
  icon: LucideIcon;
  tone?: 'acc' | 'bad';
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}> = ({ icon: Icon, tone, onClick, disabled, children }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className={clsx(
      'h-12 flex items-center justify-center gap-2 rounded-[14px] border bg-transparent text-[15px] leading-5 font-medium',
      tone === 'acc'
        ? 'border-acc-line text-acc'
        : tone === 'bad'
          ? 'border-bad-line text-bad'
          : 'border-line2 text-fg',
    )}
  >
    <Icon aria-hidden strokeWidth={2} className="w-5 h-5" />
    {children}
  </button>
);

// ---------------------------------------------------------------------------
// Bars
// ---------------------------------------------------------------------------

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
      className="shrink-0 mx-4 mb-2 flex items-center gap-2.5 py-1 pr-1 pl-3.5 rounded-xl bg-ok-soft border border-ok-line"
    >
      <Lock aria-hidden strokeWidth={2} className="w-4 h-4 shrink-0 text-ok" />
      <span className="flex-1 min-w-0 text-[13px] leading-[18px] text-fg">
        {text}
      </span>
      <button
        type="button"
        onClick={onDisconnect}
        disabled={disconnectDisabled}
        className="h-10 px-3 rounded-[10px] text-fg text-sm leading-4 font-medium disabled:opacity-50"
      >
        {t('mobile.disconnect')}
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
    <div className="shrink-0 flex items-center gap-2 py-3 px-4 border-t border-line bg-s1">
      <span className="flex-1 min-w-0 flex flex-col">
        <span className="text-[15px] leading-5 font-semibold">
          {t('mobile.count.changes', { count: changes })}
        </span>
        <span className="text-xs leading-4 text-fg2">
          {t('mobile.settings.nextConnection')}
        </span>
      </span>
      <button
        type="button"
        onClick={onDiscard}
        disabled={saving}
        aria-label={t('mobile.settings.discardChanges')}
        title={t('mobile.settings.discardChanges')}
        className="w-10 h-10 shrink-0 inline-flex items-center justify-center rounded-xl border border-line2 text-fg disabled:opacity-50"
      >
        <Undo2 aria-hidden strokeWidth={2} className="w-5 h-5" />
      </button>
      <button
        type="button"
        onClick={onSave}
        disabled={saving}
        className="h-10 px-4 rounded-xl bg-acc-fill text-white text-sm leading-4 font-medium disabled:opacity-60"
      >
        {saving ? t('settings.sources.saving') : t('settings.network.savePerf')}
      </button>
    </div>
  );
};
