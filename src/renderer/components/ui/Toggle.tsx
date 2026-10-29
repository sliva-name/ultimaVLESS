import React, { useCallback } from 'react';
import clsx from 'clsx';

interface ToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  title?: string;
  ariaLabel?: string;
}

/** 36 × 20 switch; the thumb overshoots a little when it moves. */
export const Toggle: React.FC<ToggleProps> = ({
  checked,
  onChange,
  disabled = false,
  title,
  ariaLabel,
}) => {
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
        'relative shrink-0 w-9 h-5 rounded-[10px] transition-colors duration-150 ease-linear',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        checked ? 'bg-acc-fill' : 'bg-track-off',
      )}
    >
      <span
        className={clsx(
          'absolute top-0.5 left-0.5 w-4 h-4 rounded-full shadow-[0_1px_2px_rgb(0_0_0/0.3)]',
          'transition-transform duration-150 ease-[cubic-bezier(.3,1.3,.6,1)]',
          checked ? 'translate-x-4 bg-white' : 'translate-x-0 bg-thumb-off',
        )}
      />
    </button>
  );
};
