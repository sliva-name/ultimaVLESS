import type { WindowTheme } from '@/shared/contracts/preloadApi';

/** Height of the renderer's title bar; the native buttons fill it. */
export const TITLE_BAR_HEIGHT = 40;

/** Window background before the renderer paints (the dark canvas). */
export const WINDOW_BACKGROUND = '#0e0f11';

/** Native window buttons over the title bar, in the renderer's palette. */
export const TITLE_BAR_OVERLAY: Record<
  WindowTheme,
  { color: string; symbolColor: string; height: number }
> = {
  dark: { color: '#121315', symbolColor: '#a9adb6', height: TITLE_BAR_HEIGHT },
  light: {
    color: '#ebebe7',
    symbolColor: '#4e5259',
    height: TITLE_BAR_HEIGHT,
  },
};

export function isWindowTheme(value: unknown): value is WindowTheme {
  return value === 'dark' || value === 'light';
}
