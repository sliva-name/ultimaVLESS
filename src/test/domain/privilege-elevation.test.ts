import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

vi.mock('electron', () => ({
  app: { isPackaged: false },
}));

vi.mock('@/main/services/platform/commandRunner', () => ({
  runProcessWithOutput: vi.fn(),
}));

import { runProcessWithOutput } from '@/main/services/platform/commandRunner';
import {
  buildElevatedXrayCommand,
  findPkexecPath,
  isElevatedOnWindows,
  isPkexecAvailable,
  isProcessRoot,
  resetElevationCacheForTests,
  resolveRelaunchExecutable,
  shouldElevateXray,
} from '@/main/services/PrivilegeService';

function withPlatform(platform: NodeJS.Platform, run: () => Promise<void>) {
  const original = Object.getOwnPropertyDescriptor(process, 'platform')!;
  Object.defineProperty(process, 'platform', { value: platform });
  return run().finally(() => {
    Object.defineProperty(process, 'platform', original);
  });
}

describe('isElevatedOnWindows', () => {
  beforeEach(() => {
    resetElevationCacheForTests();
    vi.mocked(runProcessWithOutput).mockReset();
  });

  it('reads the token integrity level from whoami and memoises the answer', async () => {
    await withPlatform('win32', async () => {
      vi.mocked(runProcessWithOutput).mockResolvedValue({
        code: 0,
        stdout:
          'Mandatory Label\\High Mandatory Level  Label  S-1-16-12288  Mandatory group',
        stderr: '',
      });

      await expect(isElevatedOnWindows()).resolves.toBe(true);
      await expect(isElevatedOnWindows()).resolves.toBe(true);

      expect(runProcessWithOutput).toHaveBeenCalledTimes(1);
      expect(runProcessWithOutput).toHaveBeenCalledWith(
        'whoami',
        ['/groups'],
        expect.objectContaining({ windowsHide: true }),
      );
    });
  });

  it('treats a medium integrity token as not elevated', async () => {
    await withPlatform('win32', async () => {
      vi.mocked(runProcessWithOutput).mockResolvedValue({
        code: 0,
        stdout: 'Mandatory Label\\Medium Mandatory Level  Label  S-1-16-8192',
        stderr: '',
      });

      await expect(isElevatedOnWindows()).resolves.toBe(false);
    });
  });

  it('falls back to the PowerShell principal check when whoami is unavailable', async () => {
    await withPlatform('win32', async () => {
      vi.mocked(runProcessWithOutput)
        .mockRejectedValueOnce(new Error('ENOENT'))
        .mockResolvedValueOnce({ code: 0, stdout: 'True\r\n', stderr: '' });

      await expect(isElevatedOnWindows()).resolves.toBe(true);

      expect(runProcessWithOutput).toHaveBeenCalledTimes(2);
      expect(vi.mocked(runProcessWithOutput).mock.calls[1][0]).toBe(
        'powershell',
      );
    });
  });

  it('is always true off Windows without spawning anything', async () => {
    await withPlatform('linux', async () => {
      await expect(isElevatedOnWindows()).resolves.toBe(true);
      expect(runProcessWithOutput).not.toHaveBeenCalled();
    });
  });
});

describe('resolveRelaunchExecutable', () => {
  it('relaunches through the portable stub so the temp extraction is not deleted underneath', () => {
    expect(
      resolveRelaunchExecutable(
        { PORTABLE_EXECUTABLE_FILE: 'D:\\Apps\\UltimaVLESS-Portable.exe' },
        'C:\\Temp\\abc\\UltimaVLESS.exe',
      ),
    ).toBe('D:\\Apps\\UltimaVLESS-Portable.exe');
  });

  it('uses the current executable for installed builds', () => {
    expect(
      resolveRelaunchExecutable(
        {},
        'C:\\Program Files\\UltimaVLESS\\UltimaVLESS.exe',
      ),
    ).toBe('C:\\Program Files\\UltimaVLESS\\UltimaVLESS.exe');
    expect(
      resolveRelaunchExecutable({ PORTABLE_EXECUTABLE_FILE: '  ' }, 'app.exe'),
    ).toBe('app.exe');
  });
});

describe('shouldElevateXray', () => {
  const base = {
    platform: 'linux' as NodeJS.Platform,
    mode: 'tun' as const,
    isRoot: false,
    pkexecAvailable: true,
  };

  it('elevates only for Linux TUN when unprivileged and pkexec is available', () => {
    expect(shouldElevateXray(base)).toBe(true);
  });

  it('does not elevate proxy mode', () => {
    expect(shouldElevateXray({ ...base, mode: 'proxy' })).toBe(false);
  });

  it('does not elevate when already root', () => {
    expect(shouldElevateXray({ ...base, isRoot: true })).toBe(false);
  });

  it('does not elevate when pkexec is unavailable', () => {
    expect(shouldElevateXray({ ...base, pkexecAvailable: false })).toBe(false);
  });

  it('does not elevate on non-Linux platforms', () => {
    expect(shouldElevateXray({ ...base, platform: 'win32' })).toBe(false);
    expect(shouldElevateXray({ ...base, platform: 'darwin' })).toBe(false);
  });
});

describe('buildElevatedXrayCommand', () => {
  it('runs Xray via pkexec + sh with positional bin/config/asset args', () => {
    const { command, args } = buildElevatedXrayCommand(
      '/usr/bin/pkexec',
      '/opt/app/bin/xray',
      '/home/u/.config/UltimaVLESS/config.json',
      '/opt/app/bin',
    );

    expect(command).toBe('/usr/bin/pkexec');
    expect(args[0]).toBe('/bin/sh');
    expect(args[1]).toBe('-c');
    // sh -c SCRIPT $0 $1 $2 => bin, config, asset
    expect(args.slice(3)).toEqual([
      '/opt/app/bin/xray',
      '/home/u/.config/UltimaVLESS/config.json',
      '/opt/app/bin',
    ]);
  });

  it('ties the root process lifetime to stdin EOF and forwards the asset dir', () => {
    const { args } = buildElevatedXrayCommand(
      '/usr/bin/pkexec',
      'xray',
      'c',
      'a',
    );
    const script = args[2];
    expect(script).toContain('XRAY_LOCATION_ASSET="$2"');
    expect(script).toContain('"$0" -c "$1"');
    // Blocks until the parent closes stdin, then terminates Xray.
    expect(script).toContain('cat >/dev/null');
    expect(script).toContain('kill "$xray_pid"');
    expect(script).toContain('trap terminate TERM INT EXIT');
  });
});

describe('isProcessRoot', () => {
  it('returns a boolean reflecting the current uid', () => {
    const expected =
      typeof process.getuid === 'function' && process.getuid() === 0;
    expect(isProcessRoot()).toBe(expected);
  });
});

describe('findPkexecPath / isPkexecAvailable', () => {
  const originalPath = process.env.PATH;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pkexec-test-'));
  });

  afterEach(() => {
    process.env.PATH = originalPath;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('resolves an executable pkexec found on PATH (Linux only)', () => {
    if (process.platform !== 'linux') {
      expect(findPkexecPath()).toBeNull();
      return;
    }
    const fake = path.join(tmpDir, 'pkexec');
    fs.writeFileSync(fake, '#!/bin/sh\n');
    fs.chmodSync(fake, 0o755);
    process.env.PATH = tmpDir;

    expect(findPkexecPath()).toBe(fake);
    expect(isPkexecAvailable()).toBe(true);
  });

  it('returns null when no pkexec is present on PATH', () => {
    process.env.PATH = tmpDir; // empty dir, no pkexec
    // Note: assumes the standard system paths have no pkexec in this env.
    if (process.platform === 'linux') {
      expect(findPkexecPath()).toBeNull();
      expect(isPkexecAvailable()).toBe(false);
    } else {
      expect(findPkexecPath()).toBeNull();
    }
  });
});
