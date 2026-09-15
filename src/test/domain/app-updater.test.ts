import { describe, expect, it } from 'vitest';
import {
  clipUpdateErrorMessage,
  isIncompleteReleaseError,
  isTransientUpdateError,
} from '@/main/services/updater/errorClassification';

describe('update error classification', () => {
  it('treats incomplete GitHub releases as transient', () => {
    expect(
      isIncompleteReleaseError(
        'HttpError: 404 Not Found\nGET https://github.com/org/repo/releases/download/v7.13.3/UltimaVLESS-Setup-7.13.3.exe',
      ),
    ).toBe(true);
    expect(
      isTransientUpdateError(
        'Cannot download https://github.com/org/repo/releases/latest/download/latest.yml, status 404',
      ),
    ).toBe(true);
    expect(isTransientUpdateError('ENETUNREACH 1.1.1.1:443')).toBe(true);
  });

  it('does not hide real updater failures', () => {
    expect(isTransientUpdateError('Code signature validation failed')).toBe(
      false,
    );
    expect(isTransientUpdateError('sha512 checksum mismatch')).toBe(false);
  });

  it('clips giant 404 dumps so the UI banner cannot take the window', () => {
    const dumped = `HttpError: 404 Not Found ${'https://github.com/x/y/releases/download/v1/a.exe '.repeat(20)}`;
    const clipped = clipUpdateErrorMessage(dumped);
    expect(clipped.length).toBeLessThanOrEqual(280);
    expect(clipped.endsWith('…')).toBe(true);
  });
});
