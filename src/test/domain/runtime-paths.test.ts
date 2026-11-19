import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getAppIconPath,
  getNotificationIconPath,
  getTrayIcon,
} from '@/main/utils/runtimePaths';

const electronMocks = vi.hoisted(() => {
  const addRepresentation = vi.fn();
  const resize = vi.fn(({ width }: { width: number }) => ({
    toPNG: () => Buffer.alloc(width),
  }));
  const createFromPath = vi.fn(() => ({
    isEmpty: () => false,
    resize,
  }));
  const createEmpty = vi.fn(() => ({ addRepresentation }));
  return { addRepresentation, resize, createFromPath, createEmpty };
});

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp'),
    isPackaged: false,
  },
  nativeImage: {
    createFromPath: electronMocks.createFromPath,
    createEmpty: electronMocks.createEmpty,
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getAppIconPath', () => {
  it('returns logo.ico on Windows', () => {
    expect(getAppIconPath('win32')).toBe(
      path.join(process.cwd(), 'resources/bin', 'logo.ico'),
    );
  });

  it('never returns .icns on macOS — Electron cannot decode it', () => {
    const iconPath = getAppIconPath('darwin');
    expect(iconPath).not.toContain('.icns');
    expect(iconPath).toBe(
      path.join(process.cwd(), 'resources/bin', 'logo-256x256.png'),
    );
  });

  it('returns logo-256x256.png on Linux', () => {
    expect(getAppIconPath('linux')).toBe(
      path.join(process.cwd(), 'resources/bin', 'logo-256x256.png'),
    );
  });
});

describe('getTrayIcon', () => {
  it('returns a plain path on Windows and Linux', () => {
    expect(getTrayIcon('win32')).toBe(getAppIconPath('win32'));
    expect(getTrayIcon('linux')).toBe(getAppIconPath('linux'));
    expect(electronMocks.createFromPath).not.toHaveBeenCalled();
  });

  it('returns a NativeImage with 1x and 2x representations on macOS', () => {
    const icon = getTrayIcon('darwin');
    expect(typeof icon).not.toBe('string');
    expect(electronMocks.createFromPath).toHaveBeenCalledWith(
      path.join(process.cwd(), 'resources/bin', 'logo-256x256.png'),
    );
    expect(electronMocks.addRepresentation).toHaveBeenCalledTimes(2);
    expect(electronMocks.addRepresentation).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ scaleFactor: 1, width: 18, height: 18 }),
    );
    expect(electronMocks.addRepresentation).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ scaleFactor: 2, width: 36, height: 36 }),
    );
  });

});

describe('getNotificationIconPath', () => {
  it('always uses the PNG on every platform', () => {
    expect(getNotificationIconPath()).toBe(
      path.join(process.cwd(), 'resources/bin', 'logo-256x256.png'),
    );
  });
});
