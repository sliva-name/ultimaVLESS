/* @vitest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import i18n from '@/renderer/i18n';
import App from '@/renderer/App';
import type { AppSnapshot, SessionPhase } from '@/shared/ipc';
import { resetStarPromptStoreForTests } from '@/renderer/hooks/useStarPrompt';
import {
  REPO_URL,
  STAR_PROMPT_STORAGE_KEY,
  type StarPromptState,
} from '@/renderer/utils/starPrompt';
import {
  createElectronApiMock,
  installElectronApiMock,
  type ElectronApiMock,
} from '@/test/electronApiMock';
import { makeAppSnapshot, makeServer } from '@/test/factories';

const DAY = 24 * 60 * 60 * 1000;
const FIRST = Date.UTC(2026, 10, 1);
const NOW = FIRST + 4 * DAY;

/** Four sessions already counted over three days: the next one makes it due. */
const ALMOST_DUE: StarPromptState = {
  sessions: 4,
  firstAt: FIRST,
  lastAt: FIRST + 3 * DAY,
  closed: false,
};

function snapshotWith(phase: SessionPhase, connectedAt: number): AppSnapshot {
  return makeAppSnapshot({
    servers: [makeServer({ uuid: 'nl', name: 'Нидерланды', pingTime: 1 })],
    selectedServerId: 'nl',
    session: {
      phase,
      activeServerId: phase === 'connected' ? 'nl' : null,
      lastError: null,
      blockedServerIds: [],
    },
    traffic: connectedAt
      ? {
          uploadBytes: 0,
          downloadBytes: 0,
          uploadBps: 0,
          downloadBps: 0,
          sessionDurationMs: 1000,
          connectedAt,
          sampledAt: connectedAt + 1000,
        }
      : null,
  });
}

function renderApp(
  snapshot: AppSnapshot,
  stored: StarPromptState,
): ElectronApiMock {
  localStorage.setItem(STAR_PROMPT_STORAGE_KEY, JSON.stringify(stored));
  const electronApi = createElectronApiMock();
  electronApi.getAppSnapshot.mockResolvedValue(snapshot);
  installElectronApiMock(electronApi);
  render(<App />);
  return electronApi;
}

function stored(): StarPromptState {
  return JSON.parse(
    localStorage.getItem(STAR_PROMPT_STORAGE_KEY) ?? 'null',
  ) as StarPromptState;
}

beforeAll(async () => {
  await i18n.changeLanguage('ru');
});

afterEach(() => {
  localStorage.clear();
  resetStarPromptStoreForTests();
});

describe('star card', () => {
  it('asks once the fifth session over three days is up', async () => {
    const electronApi = renderApp(snapshotWith('connected', NOW), ALMOST_DUE);

    expect(await screen.findByText('Нравится UltimaVLESS?')).toBeVisible();
    expect(stored()).toMatchObject({ sessions: 5, lastAt: NOW });

    fireEvent.click(screen.getByRole('button', { name: 'Поставить' }));
    expect(electronApi.openExternalUrl).toHaveBeenCalledWith(REPO_URL);
    await waitFor(() =>
      expect(
        screen.queryByText('Нравится UltimaVLESS?'),
      ).not.toBeInTheDocument(),
    );
    expect(stored().closed).toBe(true);
  });

  it('closes for good from the cross without opening anything', async () => {
    const electronApi = renderApp(snapshotWith('connected', NOW), ALMOST_DUE);

    fireEvent.click(await screen.findByRole('button', { name: 'Скрыть' }));
    expect(screen.queryByText('Нравится UltimaVLESS?')).not.toBeInTheDocument();
    expect(electronApi.openExternalUrl).not.toHaveBeenCalled();
    expect(stored().closed).toBe(true);
  });

  it('does not count the same session twice', async () => {
    renderApp(snapshotWith('connected', ALMOST_DUE.lastAt), ALMOST_DUE);

    await screen.findByText('Нидерланды', { selector: 'h1' });
    expect(stored()).toEqual(ALMOST_DUE);
    expect(screen.queryByText('Нравится UltimaVLESS?')).not.toBeInTheDocument();
  });

  it('stays hidden while not connected', async () => {
    const due = { ...ALMOST_DUE, sessions: 5 };
    renderApp(snapshotWith('idle', 0), due);

    await screen.findByText('Нидерланды', { selector: 'h1' });
    expect(screen.queryByText('Нравится UltimaVLESS?')).not.toBeInTheDocument();
  });

  it('stays closed after a star', async () => {
    renderApp(snapshotWith('connected', NOW), { ...ALMOST_DUE, closed: true });

    await screen.findByText('Нидерланды', { selector: 'h1' });
    expect(screen.queryByText('Нравится UltimaVLESS?')).not.toBeInTheDocument();
    expect(stored()).toEqual({ ...ALMOST_DUE, closed: true });
  });
});
