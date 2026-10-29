/** Where a popup sits: `top` when it opens down, `bottom` when it opens up. */
export interface PopupPosition {
  left: number;
  top?: number;
  bottom?: number;
  openUp: boolean;
}

export interface PopupViewport {
  width: number;
  height: number;
  /** Space taken by system bars at the edges (Android status bar, gesture strip). */
  insetTop?: number;
  insetBottom?: number;
}

/**
 * Places a popup at its trigger: under it with the right edges aligned, or
 * above it when it does not fit below and there is more room above. Opening
 * up anchors the popup's bottom, so a popup that grows (a confirmation in a
 * menu) grows away from the trigger. Shared by the desktop and Android menus,
 * which render into `document.body` so no scrolling card clips them.
 */
export function anchorPopup(
  anchor: Pick<DOMRect, 'top' | 'bottom' | 'right'>,
  size: { width: number; height: number },
  viewport: PopupViewport,
  { gap = 4, margin = 8 }: { gap?: number; margin?: number } = {},
): PopupPosition {
  const insetTop = viewport.insetTop ?? 0;
  const insetBottom = viewport.insetBottom ?? 0;
  const left = Math.max(
    margin,
    Math.min(anchor.right - size.width, viewport.width - size.width - margin),
  );
  const spaceBelow =
    viewport.height - insetBottom - margin - (anchor.bottom + gap);
  const spaceAbove = anchor.top - gap - (insetTop + margin);
  if (size.height > spaceBelow && spaceAbove > spaceBelow) {
    return { left, bottom: viewport.height - anchor.top + gap, openUp: true };
  }
  return { left, top: anchor.bottom + gap, openUp: false };
}
