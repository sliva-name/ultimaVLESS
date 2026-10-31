import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { FakeCore } from './fakeCore';

const fake = vi.hoisted(() => ({ core: null as FakeCore | null }));

// The native side outlives the WebView: a reloaded module graph gets the
// same core, with its session, back.
vi.mock('../src/native/UltimaCore', async () => {
  const { FakeCore: Fake } = await import('./fakeCore');
  fake.core ??= new Fake();
  return { UltimaCore: fake.core.plugin };
});

const REALITY_LINK = (host: string, name: string) =>
  `vless://5f1c8b3e-2a7d-4e1b-9c3a-0d6e7f8a9b10@${host}:443?encryption=none&flow=xtls-rprx-vision&security=reality&sni=www.microsoft.com&fp=chrome&pbk=SbVKOEMjK0sIlbwg4akyBg5mL5KZwwB-ed4eEE7YnRc&sid=6ba85179e30d4fc2&type=tcp#${name}`;

/** How long the session ran while the app was closed. */
const SESSION_AGE_MS = 42 * 60_000;

async function waitFor(check: () => Promise<boolean>, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('Condition not met in time');
}

/** A fresh WebView: the desktop modules and their singletons start anew. */
async function openApp(): Promise<void> {
  const { bootBackend } = await import('../src/backend/boot');
  await bootBackend();
}

describe('Android session clock', () => {
  let core: FakeCore;

  beforeAll(async () => {
    // Vitest runs on the host's Node; the WebView reports `android`.
    Object.defineProperty(process, 'platform', { value: 'android' });
    await import('../src/polyfills');
    await import('../src/native/UltimaCore');
    core = fake.core!;
    // A disabled subscription keeps the first run from adding the built-in
    // public list, which would be fetched from the network.
    core.state = JSON.stringify({
      subscriptions: [
        {
          id: 'sub-off',
          name: 'Off',
          url: 'https://example.com/sub',
          enabled: false,
        },
      ],
    });
    await openApp();
    await window.electronAPI.saveManualLinks(
      REALITY_LINK('203.0.113.10', 'NL'),
    );
    const { servers } = await window.electronAPI.getAppSnapshot();
    expect(await window.electronAPI.connect(servers[0].uuid)).toEqual({
      ok: true,
    });
    const { flushAppStore } = await import('../src/platform/appStore');
    await flushAppStore();
  });

  it('keeps counting from the real connect after the app is reopened', async () => {
    const startedAt = Date.now() - SESSION_AGE_MS;
    core.status = { ...core.status, startedAt };

    vi.resetModules();
    await openApp();
    await waitFor(
      async () =>
        (await window.electronAPI.getAppSnapshot()).session.phase ===
        'connected',
    );

    const snapshot = await window.electronAPI.getAppSnapshot();
    expect(snapshot.traffic?.connectedAt).toBe(startedAt);
    expect(snapshot.traffic?.sessionDurationMs).toBeGreaterThanOrEqual(
      SESSION_AGE_MS,
    );
    expect(snapshot.process.lastStartAt).toBe(startedAt);
    // The reopened app adopted the session instead of restarting it.
    expect(core.status.startedAt).toBe(startedAt);
  });

  it('starts from zero on the next connect', async () => {
    await window.electronAPI.disconnect();
    const { servers } = await window.electronAPI.getAppSnapshot();
    const connectedFrom = Date.now();
    expect(await window.electronAPI.connect(servers[0].uuid)).toEqual({
      ok: true,
    });
    const snapshot = await window.electronAPI.getAppSnapshot();
    expect(snapshot.traffic?.connectedAt).toBeGreaterThanOrEqual(connectedFrom);
    expect(snapshot.process.lastStartAt).toBeGreaterThanOrEqual(connectedFrom);
  });
});
