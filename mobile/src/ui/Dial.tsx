import React from 'react';
import clsx from 'clsx';
import {
  AlertTriangle,
  Power,
  RefreshCw,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import type { SessionPhase } from '@/shared/ipc';

/** Circumference of the progress arc (r = 96 in a 240 box). */
const ARC = 603.2;

interface DialLook {
  minor: string;
  major: string;
  arc: string;
  dash: string;
  arcOpacity: number;
  core: string;
  icon: LucideIcon;
  iconColor: string;
  /** Where the arc starts, degrees. */
  base: number;
}

const v = (token: string) => `var(--color-${token})`;

const LOOKS: Record<SessionPhase, DialLook> = {
  idle: {
    minor: v('line2'),
    major: v('fg3'),
    arc: v('acc'),
    dash: `0 ${ARC}`,
    arcOpacity: 0,
    core: v('line'),
    icon: Power,
    iconColor: v('acc'),
    base: -90,
  },
  connecting: {
    minor: v('line2'),
    major: v('fg3'),
    arc: v('acc'),
    dash: `150 ${ARC - 150}`,
    arcOpacity: 1,
    core: v('acc-line'),
    icon: Power,
    iconColor: v('acc'),
    base: -90,
  },
  connected: {
    minor: v('ok-line'),
    major: v('ok'),
    arc: v('ok'),
    dash: `${ARC} 0`,
    arcOpacity: 1,
    core: v('ok-line'),
    icon: ShieldCheck,
    iconColor: v('ok'),
    base: -90,
  },
  switching: {
    minor: v('acc-line'),
    major: v('acc'),
    arc: v('acc'),
    dash: '90 211.6',
    arcOpacity: 1,
    core: v('acc-line'),
    icon: RefreshCw,
    iconColor: v('acc'),
    base: -90,
  },
  disconnecting: {
    minor: v('line2'),
    major: v('fg3'),
    arc: v('fg2'),
    dash: `36 ${ARC - 36}`,
    arcOpacity: 0.9,
    core: v('line'),
    icon: Power,
    iconColor: v('fg3'),
    base: -90,
  },
  failed: {
    minor: v('warn-line'),
    major: v('warn'),
    arc: v('warn'),
    dash: `540 ${ARC - 540}`,
    arcOpacity: 1,
    core: v('warn-line'),
    icon: AlertTriangle,
    iconColor: v('warn'),
    base: -71,
  },
};

/** 72 ticks around the ring, every sixth one longer. */
function buildTicks(): { minor: string; major: string } {
  let minor = '';
  let major = '';
  for (let i = 0; i < 72; i++) {
    const isMajor = i % 6 === 0;
    const angle = (i / 72) * Math.PI * 2 - Math.PI / 2;
    const r1 = isMajor ? 101 : 105;
    const r2 = 113;
    const segment =
      `M${(120 + Math.cos(angle) * r1).toFixed(2)} ${(120 + Math.sin(angle) * r1).toFixed(2)}` +
      `L${(120 + Math.cos(angle) * r2).toFixed(2)} ${(120 + Math.sin(angle) * r2).toFixed(2)}`;
    if (isMajor) major += segment;
    else minor += segment;
  }
  return { minor, major };
}

const TICKS = buildTicks();

interface DialProps {
  phase: SessionPhase;
  /** Ring diameter in px; the control takes 28 px more for the press area. */
  size?: number;
  label: string;
  sub: string;
  /** Monospace sub line (the session timer). */
  subMono?: boolean;
  ariaLabel: string;
  disabled?: boolean;
  onPress: () => void;
}

/**
 * The connection ring shared with the desktop redesign: ticks, a progress
 * arc that turns while the core starts or switches, and the state in the
 * middle. It only draws the session phase it is given.
 */
export const Dial: React.FC<DialProps> = ({
  phase,
  size = 232,
  label,
  sub,
  subMono = false,
  ariaLabel,
  disabled = false,
  onPress,
}) => {
  const look = LOOKS[phase];
  const Icon = look.icon;
  const spinning = phase === 'connecting' || phase === 'switching';
  const iconSize = Math.round(size * 0.1);

  return (
    <div
      className="flex items-center justify-center text-fg"
      style={{ width: size + 28, height: size + 28 }}
    >
      <button
        type="button"
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={onPress}
        className={clsx(
          'relative p-0 border-0 rounded-full bg-transparent transition-transform duration-75',
          !disabled && 'active:scale-[0.98]',
        )}
        style={{ width: size, height: size }}
      >
        <svg
          width={size}
          height={size}
          viewBox="0 0 240 240"
          aria-hidden="true"
          className="absolute inset-0"
        >
          <path
            d={TICKS.minor}
            stroke={look.minor}
            strokeWidth={2}
            strokeLinecap="round"
            style={{ transition: 'stroke 420ms cubic-bezier(.2,0,0,1)' }}
          />
          <path
            d={TICKS.major}
            stroke={look.major}
            strokeWidth={2.5}
            strokeLinecap="round"
            style={{ transition: 'stroke 420ms cubic-bezier(.2,0,0,1)' }}
          />
          <circle
            cx={120}
            cy={120}
            r={96}
            fill="none"
            stroke={look.arc}
            strokeWidth={4}
            strokeLinecap="round"
            strokeDasharray={look.dash}
            opacity={look.arcOpacity}
            className="dial-arc"
            data-spin={spinning ? phase : undefined}
            style={{ '--dial-base': `${look.base}deg` } as React.CSSProperties}
          />
          <circle
            cx={120}
            cy={120}
            r={84}
            fill="var(--color-s1)"
            stroke={look.core}
            strokeWidth={1.5}
            style={{ transition: 'stroke 220ms' }}
          />
        </svg>
        <span
          className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none"
          style={{ gap: Math.round(size * 0.026) }}
        >
          {size >= 170 && (
            <Icon
              aria-hidden
              strokeWidth={1.75}
              style={{
                width: iconSize,
                height: iconSize,
                color: look.iconColor,
              }}
            />
          )}
          <span
            className="leading-[1.2] font-semibold tracking-[-0.01em] text-fg whitespace-nowrap"
            style={{ fontSize: Math.max(11, Math.round(size * 0.078)) }}
          >
            {label}
          </span>
          <span
            className={clsx(
              'leading-[1.25] text-fg2 tabular-nums text-center',
              subMono && 'font-mono',
            )}
            style={{
              fontSize: Math.max(11, Math.round(size * 0.056)),
              maxWidth: Math.round(size * 0.6),
            }}
          >
            {sub}
          </span>
        </span>
      </button>
    </div>
  );
};
