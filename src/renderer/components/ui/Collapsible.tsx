import React, { useState, useCallback } from 'react';
import clsx from 'clsx';
import { ChevronDown } from 'lucide-react';

interface CollapsibleProps {
  header: React.ReactNode;
  defaultExpanded?: boolean;
  className?: string;
  headerClassName?: string;
  bodyClassName?: string;
  onToggle?: (expanded: boolean) => void;
  children: React.ReactNode;
}

/**
 * Reusable collapsible container with a chevron toggle.
 * Used for subscription groups, manual links form, performance tuning, etc.
 */
export const Collapsible: React.FC<CollapsibleProps> = ({
  header,
  defaultExpanded = false,
  className,
  headerClassName,
  bodyClassName,
  onToggle,
  children,
}) => {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const toggle = useCallback(() => {
    setExpanded((prev) => {
      const next = !prev;
      onToggle?.(next);
      return next;
    });
  }, [onToggle]);

  return (
    <div className={clsx('overflow-hidden', className)}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={expanded}
        className={clsx(
          'w-full flex items-center justify-between text-left transition-colors',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
          headerClassName
        )}
      >
        <span className="min-w-0 flex-1">{header}</span>
        <ChevronDown
          className={clsx(
            'shrink-0 text-gray-400 transition-transform',
            expanded && 'rotate-180'
          )}
        />
      </button>
      {expanded && <div className={bodyClassName}>{children}</div>}
    </div>
  );
};
