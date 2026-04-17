import React from 'react';
import clsx from 'clsx';

interface SectionCardProps {
  className?: string;
  padding?: 'none' | 'sm' | 'md';
  children: React.ReactNode;
}

/**
 * Standard rounded surface used for blocks in Settings / Diagnostics:
 * bg-gradient + gray border.
 */
export const SectionCard: React.FC<SectionCardProps> = ({
  className,
  padding = 'md',
  children,
}) => (
  <div
    className={clsx(
      'rounded-xl border border-gray-700/50 bg-linear-to-br from-gray-800/50 to-gray-800/30',
      padding === 'md' && 'p-4',
      padding === 'sm' && 'p-3',
      className
    )}
  >
    {children}
  </div>
);
