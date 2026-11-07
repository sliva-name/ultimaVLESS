import { useEffect, useSyncExternalStore } from 'react';
import {
  closeStarPrompt,
  isStarPromptDue,
  parseStarPrompt,
  recordSession,
  REPO_URL,
  STAR_PROMPT_STORAGE_KEY,
  type StarPromptState,
} from '@/renderer/utils/starPrompt';

// One store for the whole window: the About page closes the card that the
// home page shows, without a reload.
let current: StarPromptState | null = null;
const listeners = new Set<() => void>();

function readState(): StarPromptState {
  if (!current) {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(STAR_PROMPT_STORAGE_KEY);
    } catch {
      // Storage can be unavailable; the card then stays hidden.
    }
    current = parseStarPrompt(raw);
  }
  return current;
}

function writeState(next: StarPromptState): void {
  if (next === current) return;
  current = next;
  try {
    localStorage.setItem(STAR_PROMPT_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Kept for this window only.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Opens the repository page and closes the card for good. */
export function openRepoForStar(): void {
  writeState(closeStarPrompt(readState()));
  window.electronAPI.openExternalUrl(REPO_URL).catch((error: unknown) => {
    console.error('Failed to open the repository', error);
  });
}

export function dismissStarPrompt(): void {
  writeState(closeStarPrompt(readState()));
}

/**
 * Counts verified sessions by their start time and says whether the
 * one-time card is due. It shows only while connected — right after the
 * app has just worked, never over a failure.
 */
export function useStarPrompt(connected: boolean, connectedAt: number) {
  const state = useSyncExternalStore(subscribe, readState);
  useEffect(() => {
    if (connected && connectedAt > 0) {
      writeState(recordSession(readState(), connectedAt));
    }
  }, [connected, connectedAt]);
  return connected && isStarPromptDue(state);
}

/** Drops the cached state so tests start from storage again. */
export function resetStarPromptStoreForTests(): void {
  current = null;
}
