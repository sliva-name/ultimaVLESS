import { spawn } from 'child_process';
import { app } from 'electron';

/**
 * Checks whether the current process has elevated rights on Windows.
 * TUN setup requires admin privileges to create the virtual adapter.
 * Uses async spawn to avoid blocking the main process.
 */
export async function isElevatedOnWindows(): Promise<boolean> {
  if (process.platform !== 'win32') {
    return true;
  }

  return new Promise<boolean>((resolve) => {
    const ps = spawn(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        '[Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent() | ForEach-Object { $_.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) }',
      ],
      { windowsHide: true },
    );

    const timeout = setTimeout(() => {
      ps.kill('SIGTERM');
      resolve(false);
    }, 5000);

    let stdout = '';
    ps.stdout?.on('data', (d) => {
      stdout += d.toString();
    });
    ps.on('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        resolve(false);
        return;
      }
      const output = stdout.trim().toLowerCase();
      resolve(output.includes('true'));
    });
    ps.on('error', () => {
      clearTimeout(timeout);
      resolve(false);
    });
  });
}

/**
 * Tries to relaunch the current packaged app with Administrator rights.
 * Returns false if not supported or user cancels UAC.
 */
export async function relaunchAsAdminOnWindows(): Promise<boolean> {
  if (process.platform !== 'win32') return false;
  if (!app.isPackaged) return false;

  return new Promise<boolean>((resolve) => {
    const escapedExePath = process.execPath.replace(/'/g, "''");
    const ps = spawn(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `Start-Process -FilePath '${escapedExePath}' -Verb RunAs`,
      ],
      { windowsHide: true },
    );

    ps.on('close', (code) => {
      resolve(code === 0);
    });

    ps.on('error', () => {
      resolve(false);
    });
  });
}

async function isUnixRoot(): Promise<boolean> {
  if (process.platform === 'win32') {
    return false;
  }
  if (typeof process.getuid === 'function') {
    return process.getuid() === 0;
  }
  return false;
}

/**
 * Cross-platform privilege check for TUN mode setup.
 * - Windows: Administrator rights
 * - macOS/Linux: root privileges
 */
export async function hasTunPrivileges(): Promise<boolean> {
  if (process.platform === 'win32') {
    return isElevatedOnWindows();
  }
  return isUnixRoot();
}

/**
 * Best-effort privilege escalation for TUN mode setup.
 * Currently supported only on Windows (UAC relaunch).
 */
export async function requestTunPrivilegesRelaunch(): Promise<boolean> {
  if (process.platform === 'win32') {
    return relaunchAsAdminOnWindows();
  }
  return false;
}
