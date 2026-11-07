/**
 * The one-time «star the project on GitHub» card. Most users arrive from a
 * search, install, and from then on update in the background — they never
 * see the repository page again. The card asks once, after the app has
 * proved itself: several verified sessions spread over a few days. Any
 * answer, the star or the cross, closes it for good.
 */

export const REPO_URL = 'https://github.com/sliva-name/ultimaVLESS';

export const STAR_PROMPT_STORAGE_KEY = 'starPrompt';
export const STAR_PROMPT_MIN_SESSIONS = 5;
export const STAR_PROMPT_MIN_SPAN_MS = 3 * 24 * 60 * 60 * 1000;

export interface StarPromptState {
  /** Distinct verified sessions, counted until the card closes. */
  sessions: number;
  /** `connectedAt` of the first and of the latest counted session, epoch ms. */
  firstAt: number;
  lastAt: number;
  /** Starred or dismissed: never shown again. */
  closed: boolean;
}

export const INITIAL_STAR_PROMPT: StarPromptState = {
  sessions: 0,
  firstAt: 0,
  lastAt: 0,
  closed: false,
};

/**
 * Counts a session once, keyed by its start time: repeated snapshots of the
 * same session, a remounted page or an adopted core do not add up.
 */
export function recordSession(
  state: StarPromptState,
  connectedAt: number,
): StarPromptState {
  if (state.closed || connectedAt <= 0 || connectedAt === state.lastAt) {
    return state;
  }
  return {
    ...state,
    sessions: state.sessions + 1,
    firstAt: state.firstAt || connectedAt,
    lastAt: connectedAt,
  };
}

export function closeStarPrompt(state: StarPromptState): StarPromptState {
  return state.closed ? state : { ...state, closed: true };
}

export function isStarPromptDue(state: StarPromptState): boolean {
  return (
    !state.closed &&
    state.sessions >= STAR_PROMPT_MIN_SESSIONS &&
    state.lastAt - state.firstAt >= STAR_PROMPT_MIN_SPAN_MS
  );
}

function timestamp(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : 0;
}

/** Whatever storage holds — missing, foreign or broken — reads as a state. */
export function parseStarPrompt(raw: string | null): StarPromptState {
  if (!raw) return INITIAL_STAR_PROMPT;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return INITIAL_STAR_PROMPT;
    const stored = value as Record<string, unknown>;
    return {
      sessions: Math.floor(timestamp(stored.sessions)),
      firstAt: timestamp(stored.firstAt),
      lastAt: timestamp(stored.lastAt),
      closed: stored.closed === true,
    };
  } catch {
    return INITIAL_STAR_PROMPT;
  }
}
