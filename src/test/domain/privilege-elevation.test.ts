import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { spawn } from 'child_process';
import crypto from 'crypto';
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
  describeElevatedWrapperExit,
  ELEVATED_WRAPPER_EXIT,
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
  it('runs Xray via pkexec + sh with positional bin/config/asset/hash args', () => {
    const { command, args } = buildElevatedXrayCommand(
      '/usr/bin/pkexec',
      '/opt/app/bin/xray',
      '/home/u/.config/UltimaVLESS/config.json',
      '/opt/app/bin',
    );

    expect(command).toBe('/usr/bin/pkexec');
    expect(args[0]).toBe('/bin/sh');
    expect(args[1]).toBe('-c');
    // sh -c SCRIPT $0 $1 $2 $3 => bin, config, asset, hash ('' = in place)
    expect(args.slice(3)).toEqual([
      '/opt/app/bin/xray',
      '/home/u/.config/UltimaVLESS/config.json',
      '/opt/app/bin',
      '',
    ]);
  });

  it('passes the expected hash of a staged binary', () => {
    const { args } = buildElevatedXrayCommand(
      '/usr/bin/pkexec',
      '/home/u/.config/UltimaVLESS/elevated-core/xray',
      'c',
      '/home/u/.config/UltimaVLESS/elevated-core',
      'ab12',
    );
    expect(args[6]).toBe('ab12');
  });
});

describe('describeElevatedWrapperExit', () => {
  it('names the root wrapper failures', () => {
    expect(
      describeElevatedWrapperExit(ELEVATED_WRAPPER_EXIT.COPY_FAILED),
    ).toMatch(/root-owned copy/);
    expect(
      describeElevatedWrapperExit(ELEVATED_WRAPPER_EXIT.CHECKSUM_MISMATCH),
    ).toMatch(/does not match/);
    expect(describeElevatedWrapperExit(ELEVATED_WRAPPER_EXIT.EXEC_FAILED)).toBe(
      'TUN mode could not run Xray as root',
    );
  });

  it('leaves Xray and pkexec exit codes alone', () => {
    for (const code of [null, 0, 1, 23, 126, 127]) {
      expect(describeElevatedWrapperExit(code)).toBeNull();
    }
  });
});

// The wrapper is what pkexec runs as root; run it for real (minus pkexec).
const canRunWrapper =
  process.platform === 'linux' &&
  fs.existsSync('/bin/sh') &&
  fs.existsSync('/usr/bin/env');

describe.runIf(canRunWrapper)('root wrapper under /bin/sh', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-wrapper-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function fakeXray(body: string, mode = 0o755): string {
    const file = path.join(tmpDir, 'xray');
    fs.writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode });
    return file;
  }

  function runWrapper(binPath: string, binSha256: string | null = null) {
    const { command, args } = buildElevatedXrayCommand(
      '/usr/bin/env',
      binPath,
      path.join(tmpDir, 'config.json'),
      tmpDir,
      binSha256,
    );
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    const exited = new Promise<number | null>((resolve) =>
      child.on('close', (code) => resolve(code)),
    );
    return { child, exited, stdout: () => stdout };
  }

  it("exits with Xray's code as soon as Xray fails, stdin still open", async () => {
    const { child, exited } = runWrapper(fakeXray('exit 23'));

    await expect(exited).resolves.toBe(23);
    expect(child.stdin.writableEnded).toBe(false);
  });

  it('stops Xray when the parent closes stdin', async () => {
    const run = runWrapper(
      fakeXray("trap 'exit 0' TERM\necho up\nwhile :; do sleep 0.1; done"),
    );
    await vi.waitFor(() => expect(run.stdout()).toContain('up'));

    run.child.stdin.end();

    await expect(run.exited).resolves.toBe(0);
  });

  it('reports a binary sh cannot execute as its own code, not as a pkexec one', async () => {
    const { exited } = runWrapper(fakeXray('exit 0', 0o644));

    await expect(exited).resolves.toBe(ELEVATED_WRAPPER_EXIT.EXEC_FAILED);
  });

  it('runs a staged binary only from its own copy, and only when it matches', async () => {
    const binPath = fakeXray('echo "$0 $XRAY_LOCATION_ASSET"\nexit 7');
    const sha256 = crypto
      .createHash('sha256')
      .update(fs.readFileSync(binPath))
      .digest('hex');

    const matching = runWrapper(binPath, sha256);
    await expect(matching.exited).resolves.toBe(7);
    const [ranFrom, assetDir] = matching.stdout().trim().split(' ');
    expect(ranFrom).not.toBe(binPath);
    expect(ranFrom).toMatch(/\/xray$/);
    expect(fs.existsSync(ranFrom)).toBe(false);
    expect(assetDir).toBe(tmpDir);

    const tampered = runWrapper(binPath, '0'.repeat(64));
    await expect(tampered.exited).resolves.toBe(
      ELEVATED_WRAPPER_EXIT.CHECKSUM_MISMATCH,
    );
    expect(tampered.stdout()).toBe('');
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

  it('does not resolve a pkexec planted on user PATH', () => {
    const fake = path.join(tmpDir, 'pkexec');
    fs.writeFileSync(fake, '#!/bin/sh\n');
    try {
      fs.chmodSync(fake, 0o755);
    } catch {
      // chmod is a no-op on Windows; the file still must not be chosen.
    }
    process.env.PATH = tmpDir;

    expect(findPkexecPath()).not.toBe(fake);
  });

  it('returns null when no pkexec is present in system directories', () => {
    process.env.PATH = tmpDir;
    if (process.platform !== 'linux') {
      expect(findPkexecPath()).toBeNull();
      return;
    }
    const systemCopy =
      fs.existsSync('/usr/bin/pkexec') ||
      fs.existsSync('/bin/pkexec') ||
      fs.existsSync('/usr/local/bin/pkexec');
    if (systemCopy) {
      expect(findPkexecPath()).toMatch(/pkexec$/);
      expect(isPkexecAvailable()).toBe(true);
    } else {
      expect(findPkexecPath()).toBeNull();
      expect(isPkexecAvailable()).toBe(false);
    }
  });
});
