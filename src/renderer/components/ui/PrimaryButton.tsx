import React from 'react';
import clsx from 'clsx';

interface PrimaryButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  block?: boolean;
}

/**
 * Standard primary gradient button (primary → blue-600).
 * Used across forms in SettingsModal, add subscription, save manual links, etc.
 */
export const PrimaryButton: React.FC<PrimaryButtonProps> = ({
  block = false,
  className,
  children,
  disabled,
  ...rest
}) => (
  <button
    {...rest}
    disabled={disabled}
    className={clsx(
      'flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white',
      'bg-linear-to-r from-primary to-blue-600 hover:from-blue-500 hover:to-blue-700',
      'disabled:opacity-50 disabled:cursor-not-allowed transition-all',
      'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60',
      block && 'w-full',
      className,
    )}
  >
    {children}
  </button>
);
