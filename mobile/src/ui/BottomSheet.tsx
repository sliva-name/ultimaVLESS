import React, { useCallback, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';

/** Matches `.sheet-motion` in mobile.css. */
const MOTION_MS = 250;
/** Released below this share of its height, the sheet closes. */
const CLOSE_SHARE = 0.25;
/** A downward fling faster than this (px/ms) closes it too. */
const FLING_SPEED = 0.5;

/**
 * `closing-self`: the sheet closed itself and tells the screen once it is
 * gone; `closing-route`: the route already closed it (the system back).
 */
type Phase = 'closed' | 'entering' | 'open' | 'closing-self' | 'closing-route';

const motionMs = () =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
    ? 0
    : MOTION_MS;

interface BottomSheetProps {
  /** Shown while true; the screen's route decides, so the system back works. */
  open: boolean;
  label: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  /**
   * The sheet closed itself (scrim, swipe, a `close` from the content), once
   * its animation has ended: leave the route that shows it.
   */
  onClose: () => void;
  /** The content gets `close`, which animates the sheet out first. */
  children: (close: () => void) => React.ReactNode;
}

/**
 * Material bottom sheet: slides up over a scrim, follows the finger when its
 * handle or title is dragged down, and closes past a quarter of its height or
 * on a fling. Every way to close it (scrim, swipe, system back, Escape, the
 * content's own buttons) plays the same animation.
 */
export const BottomSheet: React.FC<BottomSheetProps> = ({
  open,
  label,
  title,
  description,
  onClose,
  children,
}) => {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>(open ? 'entering' : 'closed');
  const [shownOpen, setShownOpen] = useState(open);
  /** How far the sheet is dragged down, and its height when the drag began. */
  const [drag, setDrag] = useState<{ y: number; height: number } | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  /** The handle's click right after a drag is not a tap. */
  const suppressClickRef = useRef(false);
  const dragRef = useRef<{
    startY: number;
    height: number;
    moved: boolean;
    samples: { y: number; t: number }[];
  } | null>(null);

  // The route opened or closed the sheet (a tap, the system back).
  if (open !== shownOpen) {
    setShownOpen(open);
    if (open) {
      setPhase(phase === 'closed' ? 'entering' : 'open');
    } else if (phase === 'entering' || phase === 'open') {
      setPhase('closing-route');
      setDrag(null);
    }
  }

  const close = useCallback(() => {
    if (phase !== 'open' && phase !== 'entering') return;
    setDrag(null);
    setPhase('closing-self');
  }, [phase]);

  // Off screen for one frame, then slide in.
  useEffect(() => {
    if (phase !== 'entering') return;
    if (document.activeElement instanceof HTMLElement) {
      returnFocusRef.current = document.activeElement;
    }
    const frame = requestAnimationFrame(() => setPhase('open'));
    return () => cancelAnimationFrame(frame);
  }, [phase]);

  useEffect(() => {
    if (phase !== 'open') return;
    sheetRef.current
      ?.querySelector<HTMLElement>('input, textarea, select')
      ?.focus({ preventScroll: true });
  }, [phase]);

  useEffect(() => {
    if (phase !== 'closing-self' && phase !== 'closing-route') return;
    const timer = window.setTimeout(() => {
      setPhase('closed');
      returnFocusRef.current?.focus({ preventScroll: true });
      if (phase === 'closing-self') onClose();
    }, motionMs());
    return () => window.clearTimeout(timer);
  }, [phase, onClose]);

  // Escape on a hardware keyboard; the keyboard opening keeps the field in view.
  useEffect(() => {
    if (phase !== 'open') return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    const onResize = () => {
      const focused = document.activeElement;
      if (
        focused instanceof HTMLElement &&
        sheetRef.current?.contains(focused)
      ) {
        focused.scrollIntoView({ block: 'nearest' });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onResize);
    };
  }, [phase, close]);

  if (phase === 'closed') return null;

  const onPointerDown = (event: React.PointerEvent) => {
    if (phase !== 'open') return;
    suppressClickRef.current = false;
    dragRef.current = {
      startY: event.clientY,
      height: sheetRef.current?.offsetHeight ?? 0,
      moved: false,
      samples: [{ y: event.clientY, t: event.timeStamp }],
    };
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const current = dragRef.current;
    if (!current) return;
    // Up stops at the open position.
    const dy = Math.max(0, event.clientY - current.startY);
    if (dy > 4 && !current.moved) {
      current.moved = true;
      // Only a real drag takes the pointer: a tap still reaches the handle.
      event.currentTarget.setPointerCapture?.(event.pointerId);
    }
    current.samples = [
      ...current.samples,
      { y: event.clientY, t: event.timeStamp },
    ].slice(-4);
    setDrag({ y: dy, height: current.height });
  };

  const onPointerUp = () => {
    const current = dragRef.current;
    dragRef.current = null;
    if (!current || !drag) return;
    suppressClickRef.current = current.moved;
    const [previous, last] = current.samples.slice(-2);
    const elapsed = last && previous ? last.t - previous.t : 0;
    // Events closer than a frame carry no usable speed.
    const speed = elapsed >= 4 ? (last.y - previous.y) / elapsed : 0;
    if (drag.y > drag.height * CLOSE_SHARE || speed > FLING_SPEED) close();
    else setDrag(null);
  };

  const onPointerCancel = () => {
    dragRef.current = null;
    setDrag(null);
  };

  const shown = phase === 'open';
  const scrimOpacity = shown
    ? 1 - Math.min(1, (drag?.y ?? 0) / Math.max(1, drag?.height ?? 1))
    : 0;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div
        aria-hidden="true"
        data-sheet-scrim
        className={clsx('absolute inset-0 bg-scrim', !drag && 'scrim-motion')}
        style={{ opacity: scrimOpacity }}
        onClick={close}
      />
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={clsx(
          'mobile-inset-bottom relative max-h-full flex flex-col rounded-t-[28px] bg-s1 border-t border-line2',
          !drag && 'sheet-motion',
        )}
        style={{
          transform: shown
            ? `translateY(${drag?.y ?? 0}px)`
            : 'translateY(100%)',
        }}
      >
        <div
          data-sheet-drag
          className="shrink-0 flex flex-col gap-4 pt-2 px-5 touch-none select-none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
        >
          <button
            type="button"
            aria-label={t('mobile.close')}
            onClick={() => {
              if (suppressClickRef.current) {
                suppressClickRef.current = false;
                return;
              }
              close();
            }}
            className="self-center h-4 w-12 flex items-center justify-center"
          >
            <span aria-hidden="true" className="w-8 h-1 rounded-sm bg-line2" />
          </button>
          <div className="flex flex-col gap-1">
            <h2 className="m-0 text-xl leading-[26px] font-semibold tracking-[-0.01em]">
              {title}
            </h2>
            {description && (
              <p className="m-0 text-[13px] leading-[18px] text-fg3">
                {description}
              </p>
            )}
          </div>
        </div>
        <div className="min-h-0 overflow-y-auto overscroll-contain px-5 pt-4">
          {children(close)}
        </div>
      </div>
    </div>
  );
};
