import { describe, expect, it } from 'vitest';
import {
  closeStarPrompt,
  INITIAL_STAR_PROMPT,
  isStarPromptDue,
  parseStarPrompt,
  recordSession,
  STAR_PROMPT_MIN_SESSIONS,
  STAR_PROMPT_MIN_SPAN_MS,
  type StarPromptState,
} from '@/renderer/utils/starPrompt';

const DAY = 24 * 60 * 60 * 1000;
const START = Date.UTC(2026, 10, 1);

function sessionsAt(times: number[]): StarPromptState {
  return times.reduce(recordSession, INITIAL_STAR_PROMPT);
}

describe('star prompt', () => {
  it('counts each session once, by its start time', () => {
    let state = recordSession(INITIAL_STAR_PROMPT, START);
    state = recordSession(state, START);
    state = recordSession(state, START);
    expect(state).toEqual({
      sessions: 1,
      firstAt: START,
      lastAt: START,
      closed: false,
    });

    state = recordSession(state, START + DAY);
    expect(state.sessions).toBe(2);
    expect(state.firstAt).toBe(START);
    expect(state.lastAt).toBe(START + DAY);
  });

  it('ignores a session without a start time', () => {
    expect(recordSession(INITIAL_STAR_PROMPT, 0)).toBe(INITIAL_STAR_PROMPT);
  });

  it('is due after five sessions spread over three days', () => {
    expect(STAR_PROMPT_MIN_SESSIONS).toBe(5);
    expect(STAR_PROMPT_MIN_SPAN_MS).toBe(3 * DAY);

    // Five sessions in one evening: still trying the app out.
    const sameDay = sessionsAt([0, 1, 2, 3, 4].map((h) => START + h * 3600e3));
    expect(isStarPromptDue(sameDay)).toBe(false);

    // Three days of use, but only four sessions.
    const fewSessions = sessionsAt([0, 1, 2, 3].map((d) => START + d * DAY));
    expect(isStarPromptDue(fewSessions)).toBe(false);

    const due = recordSession(fewSessions, START + 3 * DAY + 1);
    expect(isStarPromptDue(due)).toBe(true);
  });

  it('never comes back once closed', () => {
    const due = sessionsAt([0, 1, 2, 3, 4].map((d) => START + d * DAY));
    const closed = closeStarPrompt(due);
    expect(isStarPromptDue(closed)).toBe(false);
    expect(recordSession(closed, START + 10 * DAY)).toBe(closed);
    expect(closeStarPrompt(closed)).toBe(closed);
  });

  it('reads missing or broken storage as a fresh state', () => {
    expect(parseStarPrompt(null)).toEqual(INITIAL_STAR_PROMPT);
    expect(parseStarPrompt('not json')).toEqual(INITIAL_STAR_PROMPT);
    expect(parseStarPrompt('42')).toEqual(INITIAL_STAR_PROMPT);
    expect(
      parseStarPrompt('{"sessions":"7","firstAt":-1,"lastAt":null}'),
    ).toEqual(INITIAL_STAR_PROMPT);
  });

  it('round-trips a stored state', () => {
    const state = sessionsAt([START, START + DAY]);
    expect(parseStarPrompt(JSON.stringify(state))).toEqual(state);
    const closed = closeStarPrompt(state);
    expect(parseStarPrompt(JSON.stringify(closed))).toEqual(closed);
  });
});
