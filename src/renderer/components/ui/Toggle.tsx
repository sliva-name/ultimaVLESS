import React, { useCallback } from 'react';
import clsx from 'clsx';

export type ToggleSize = 'sm' | 'md';

interface ToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  size?: ToggleSize;
  title?: string;
  ariaLabel?: string;
}

const SIZE_CLASSES: Record<
  ToggleSize,
  {
    track: string;
    thumb: string;
    thumbOn: string;
  }
> = {
  sm: {
    track: 'w-10 h-5',
    thumb: 'top-0.5 left-0.5 w-4 h-4',
    thumbOn: 'translate-x-5',
  },
  md: {
    track: 'w-12 h-6',
    thumb: 'top-1 left-1 w-4 h-4',
    thumbOn: 'translate-x-6',
  },
};

export const Toggle: React.FC<ToggleProps> = ({
  checked,
  onChange,
  disabled = false,
  size = 'sm',
  title,
  ariaLabel,
}) => {
  const sizes = SIZE_CLASSES[size];
  const handleClick = useCallback(() => {
    if (!disabled) onChange(!checked);
  }, [checked, disabled, onChange]);

  return (
    <button
      type="button"
      onClick={handleClick}
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      title={title}
      className={clsx(
        'relative shrink-0 rounded-full transition-colors duration-200',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        sizes.track,
        checked ? 'bg-primary' : 'bg-gray-700'
      )}
    >
      <span
        className={clsx(
          'absolute bg-white rounded-full transition-transform duration-200',
          sizes.thumb,
          checked ? sizes.thumbOn : 'translate-x-0'
        )}
      />
    </button>
  );
};
