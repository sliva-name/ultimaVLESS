import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HttpRequestOptions } from '../src/native/UltimaCore';
import type { FakeCore } from './fakeCore';

const fake = vi.hoisted(() => ({ core: null as FakeCore | null }));

vi.mock('../src/native/UltimaCore', async () => {
  const { FakeCore: Fake } = await import('./fakeCore');
  fake.core = new Fake();
  return { UltimaCore: fake.core.plugin };
});

const REPO = 'https://github.com/sliva-name/ultimaVLESS';

function github(
  latestTag: string | null,
  assets: string[],
  status = 302,
): (options: HttpRequestOptions) => {
  status: number;
  headers: Record<string, string>;
  body: string;
  truncated: boolean;
} {
  return (options) => {
    if (options.url === `${REPO}/releases/latest`) {
      return {
        status,
        headers: latestTag
          ? { location: `${REPO}/releases/tag/${latestTag}` }
          : {},
        body: '',
        truncated: false,
      };
    }
    const name = options.url.split('/').pop() ?? '';
    return {
      status: assets.includes(name) ? 302 : 404,
      headers: {},
      body: '',
      truncated: false,
    };
  };
}

describe('Android updater', () => {
  let updater: typeof import('../src/platform/AppUpdaterService');

  beforeAll(async () => {
    const { configureElectronShim } = await import('../src/electron');
    configureElectronShim({ dataDir: '/data', version: '7.20.1' });
    updater = await import('../src/platform/AppUpdaterService');
  });

  beforeEach(() => {
    fake.core!.httpHandler = github(null, []);
  });

  it('reads the release tag from the /releases/latest redirect', () => {
    expect(updater.tagFromLatestRedirect(`${REPO}/releases/tag/v7.21.0`)).toBe(
      'v7.21.0',
    );
    expect(updater.tagFromLatestRedirect(`${REPO}/releases`)).toBeNull();
  });

  it('prefers the APK built for the device ABI', () => {
    expect(updater.apkAssetNames('7.21.0', 'arm64-v8a')).toEqual([
      'UltimaVLESS-Android-7.21.0-arm64-v8a.apk',
      'UltimaVLESS-Android-7.21.0-universal.apk',
    ]);
  });

  it('downloads a newer release without touching api.github.com', async () => {
    const requested: string[] = [];
    const handler = github('v7.21.0', [
      'UltimaVLESS-Android-7.21.0-arm64-v8a.apk',
    ]);
    fake.core!.httpHandler = (options) => {
      requested.push(options.url);
      return handler(options);
    };
    const service = new updater.AppUpdaterService();
    await service.checkForUpdates();
    expect(service.getStatus()).toMatchObject({
      stage: 'downloaded',
      version: '7.21.0',
    });
    expect(service.hasDownloadedUpdate()).toBe(true);
    expect(requested.every((url) => url.startsWith(REPO))).toBe(true);
  });

  it('falls back to the universal APK', async () => {
    fake.core!.httpHandler = github('v7.21.0', [
      'UltimaVLESS-Android-7.21.0-universal.apk',
    ]);
    const download = vi.spyOn(fake.core!.plugin, 'downloadUpdate');
    const service = new updater.AppUpdaterService();
    await service.checkForUpdates();
    expect(download).toHaveBeenCalledWith(
      expect.objectContaining({
        fileName: 'UltimaVLESS-Android-7.21.0-universal.apk',
      }),
    );
    download.mockRestore();
  });

  it('reports nothing when the release has no Android build or is not newer', async () => {
    fake.core!.httpHandler = github('v7.21.0', []);
    const service = new updater.AppUpdaterService();
    await service.checkForUpdates();
    expect(service.getStatus().stage).toBe('not-available');

    fake.core!.httpHandler = github('v7.20.1', [
      'UltimaVLESS-Android-7.20.1-universal.apk',
    ]);
    await service.checkForUpdates();
    expect(service.getStatus().stage).toBe('not-available');
  });

  it('keeps a failed check quiet instead of showing an error banner', async () => {
    fake.core!.httpHandler = github(null, [], 403);
    const service = new updater.AppUpdaterService();
    await service.checkForUpdates();
    expect(service.getStatus()).toMatchObject({ stage: 'idle', error: null });
  });

  it('shows a failed download of a found update', async () => {
    fake.core!.httpHandler = github('v7.21.0', [
      'UltimaVLESS-Android-7.21.0-arm64-v8a.apk',
    ]);
    const download = vi
      .spyOn(fake.core!.plugin, 'downloadUpdate')
      .mockRejectedValue(new Error('Download was cut short'));
    const service = new updater.AppUpdaterService();
    await service.checkForUpdates();
    expect(service.getStatus()).toMatchObject({
      stage: 'error',
      error: 'Download was cut short',
    });
    download.mockRestore();
  });
});
