import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createMockChildProcess } from '@/test/mockChildProcess';

const mockState = vi.hoisted(() => ({
  tempDir: '',
}));
const spawnMock = vi.hoisted(() => vi.fn());

vi.mock('child_process', () => ({
  spawn: spawnMock,
  default: { spawn: spawnMock },
  __esModule: true,
}));

describe('windowsProxyRecovery', () => {
  beforeEach(() => {
    mockState.tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'ultima-proxy-recovery-'),
    );
    process.env.ProgramData = mockState.tempDir;
    spawnMock.mockReset();
    spawnMock.mockImplementation(() => {
      const child = createMockChildProcess();
      queueMicrotask(() => child.emit('close', 0));
      return child;
    });
  });

  afterEach(() => {
    delete process.env.ProgramData;
    fs.rmSync(mockState.tempDir, { recursive: true, force: true });
    vi.resetModules();
  });

  it('writes ProgramData launcher files and registers Run key + scheduled task', async () => {
    const snapshotPath =
      'C:\\Users\\Test\\AppData\\Roaming\\UltimaVLESS\\system-proxy-state.json';
    const {
      installLogonRecovery,
      getRecoveryCmdPath,
      getRecoveryScriptPath,
      getProgramDataRecoveryDir,
      WINDOWS_PROXY_RECOVERY_TASK_NAME,
      RUN_KEY_VALUE_NAME,
    } = await import('./windowsProxyRecovery');

    await installLogonRecovery(snapshotPath);

    const recoveryDir = getProgramDataRecoveryDir();
    expect(fs.existsSync(path.join(recoveryDir, 'recovery-target.txt'))).toBe(
      true,
    );
    expect(
      fs.readFileSync(path.join(recoveryDir, 'recovery-target.txt'), 'utf8'),
    ).toBe(snapshotPath);
    expect(fs.existsSync(getRecoveryCmdPath())).toBe(true);
    expect(fs.readFileSync(getRecoveryScriptPath(), 'utf8')).toContain(
      'netsh winhttp reset proxy',
    );

    const cmdPath = getRecoveryCmdPath();
    expect(spawnMock).toHaveBeenCalledWith(
      'reg',
      expect.arrayContaining([
        'add',
        '/v',
        RUN_KEY_VALUE_NAME,
        '/d',
        `"${cmdPath}"`,
      ]),
      expect.objectContaining({ windowsHide: true }),
    );
    expect(spawnMock).toHaveBeenCalledWith(
      'schtasks',
      expect.arrayContaining([
        '/Create',
        '/TN',
        WINDOWS_PROXY_RECOVERY_TASK_NAME,
        '/SC',
        'ONLOGON',
        '/TR',
        cmdPath,
      ]),
      expect.objectContaining({ windowsHide: true }),
    );
  });

  it('removes Run key, scheduled task, and recovery target on uninstall', async () => {
    const {
      installLogonRecovery,
      uninstallLogonRecovery,
      getProgramDataRecoveryDir,
      RUN_KEY_VALUE_NAME,
      WINDOWS_PROXY_RECOVERY_TASK_NAME,
    } = await import('./windowsProxyRecovery');

    await installLogonRecovery('C:\\snapshot.json');
    await uninstallLogonRecovery();

    expect(
      fs.existsSync(
        path.join(getProgramDataRecoveryDir(), 'recovery-target.txt'),
      ),
    ).toBe(false);
    expect(spawnMock).toHaveBeenCalledWith(
      'reg',
      expect.arrayContaining(['delete', '/v', RUN_KEY_VALUE_NAME]),
      expect.anything(),
    );
    expect(spawnMock).toHaveBeenCalledWith(
      'schtasks',
      ['/Delete', '/TN', WINDOWS_PROXY_RECOVERY_TASK_NAME, '/F'],
      expect.anything(),
    );
  });
});
