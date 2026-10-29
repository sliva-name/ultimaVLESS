import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type { WindowTheme } from '@/shared/contracts/preloadApi';

/** «Как в системе», «Светлая», «Тёмная»: a visual preference only. */
export type ThemePreference = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

export function readThemePreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'system' || stored === 'light' || stored === 'dark') {
      return stored;
    }
  } catch {
    // Storage can be unavailable; the default still renders.
  }
  return 'dark';
}

function subscribeSystemTheme(onChange: () => void): () => void {
  if (typeof window.matchMedia !== 'function') return () => undefined;
  const query = window.matchMedia(DARK_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

function systemTheme(): WindowTheme {
  return typeof window.matchMedia === 'function' &&
    !window.matchMedia(DARK_QUERY).matches
    ? 'light'
    : 'dark';
}

/**
 * The window theme. Dark «Графит» is the default; «Как в системе» follows the
 * OS setting while the window is open. The palette goes on <html> and the
 * native window buttons are recolored to match.
 */
export function useTheme() {
  const [preference, setPreferenceState] =
    useState<ThemePreference>(readThemePreference);
  const system = useSyncExternalStore(subscribeSystemTheme, systemTheme);
  const resolved: WindowTheme = preference === 'system' ? system : preference;

  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
    void window.electronAPI?.setWindowTheme?.(resolved).catch(() => {
      // The renderer palette still applies; only the buttons keep their color.
    });
  }, [resolved]);

  const setPreference = useCallback((next: ThemePreference) => {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Applies for this session only.
    }
    setPreferenceState(next);
  }, []);

  return { preference, resolved, setPreference };
}
