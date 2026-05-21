import { app } from 'electron';
import { runProcessWithOutput } from './platform/commandRunner';

/**
 * Checks whether the current process has elevated rights on Windows.
 * TUN setup requires admin privileges to create the virtual adapter.
 * Uses async spawn to avoid blocking the main process.
 */
export async function isElevatedOnWindows(): Promise<boolean> {
  if (process.platform !== 'win32') {
    return true;
  }

  try {
    const output = await runProcessWithOutput(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        '[Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent() | ForEach-Object { $_.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) }',
      ],
      { timeoutMs: 5000, windowsHide: true },
    );
    return (
      output.code === 0 && output.stdout.trim().toLowerCase().includes('true')
    );
  } catch {
    return false;
  }
}

/**
 * Tries to relaunch the current packaged app with Administrator rights.
 * Returns false if not supported or user cancels UAC.
 */
export async function relaunchAsAdminOnWindows(): Promise<boolean> {
  if (process.platform !== 'win32') return false;
  if (!app.isPackaged) return false;

  try {
    const escapedExePath = process.execPath.replace(/'/g, "''");
    const output = await runProcessWithOutput(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `Start-Process -FilePath '${escapedExePath}' -Verb RunAs`,
      ],
      { timeoutMs: 10000, windowsHide: true },
    );
    return output.code === 0;
  } catch {
    return false;
  }
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
