import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { runProcessWithOutput } from './platform/commandRunner';
import { RELAUNCH_ARG } from '@/shared/constants';
import type { ConnectionMode } from '@/shared/types';

/**
 * Integrity-level SIDs that only an elevated token carries. `whoami /groups`
 * prints the mandatory label of the current token; the SID is locale-neutral
 * while the label name is not.
 */
const ELEVATED_INTEGRITY_SIDS = /\bS-1-16-(12288|16384)\b/;

let windowsElevationCheck: Promise<boolean> | null = null;

async function detectWindowsElevationViaWhoami(): Promise<boolean | null> {
  try {
    const output = await runProcessWithOutput('whoami', ['/groups'], {
      timeoutMs: 5000,
      windowsHide: true,
    });
    if (output.code !== 0) {
      return null;
    }
    return ELEVATED_INTEGRITY_SIDS.test(output.stdout);
  } catch {
    return null;
  }
}

async function detectWindowsElevationViaPowerShell(): Promise<boolean> {
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

async function detectWindowsElevation(): Promise<boolean> {
  // `whoami` answers in ~50–100 ms; a fresh PowerShell host needs ~0.5–1.5 s.
  const viaWhoami = await detectWindowsElevationViaWhoami();
  if (viaWhoami !== null) {
    return viaWhoami;
  }
  return detectWindowsElevationViaPowerShell();
}

/**
 * Checks whether the current process has elevated rights on Windows.
 * TUN setup requires admin privileges to create the virtual adapter.
 *
 * The token of a running process never changes, so the answer is computed
 * once and memoised: connect, the settings dialog and the startup recovery
 * all ask, and each used to pay for its own PowerShell spawn.
 */
export function isElevatedOnWindows(): Promise<boolean> {
  if (process.platform !== 'win32') {
    return Promise.resolve(true);
  }
  windowsElevationCheck ??= detectWindowsElevation().catch(() => false);
  return windowsElevationCheck;
}

/** Test seam: forget the memoised elevation answer. */
export function resetElevationCacheForTests(): void {
  windowsElevationCheck = null;
}

/**
 * Executable to start when the app has to re-launch itself. A portable build
 * runs from a temp directory that the portable stub deletes as soon as the
 * original instance exits, so the replacement must go through the stub
 * (`PORTABLE_EXECUTABLE_FILE`) and get its own extraction — not reuse
 * `process.execPath`, which would vanish underneath it.
 */
export function resolveRelaunchExecutable(
  env: NodeJS.ProcessEnv = process.env,
  execPath: string = process.execPath,
): string {
  const portableStub = env.PORTABLE_EXECUTABLE_FILE?.trim();
  return portableStub ? portableStub : execPath;
}

/**
 * Tries to relaunch the current packaged app with Administrator rights.
 * Returns false if not supported or user cancels UAC.
 */
export async function relaunchAsAdminOnWindows(): Promise<boolean> {
  if (process.platform !== 'win32') return false;
  if (!app.isPackaged) return false;

  try {
    const escapedExePath = resolveRelaunchExecutable().replace(/'/g, "''");
    // A cancelled UAC prompt raises a non-terminating error, which PowerShell
    // still reports as exit code 0. Without the explicit try/catch the caller
    // would believe an elevated instance is starting and quit this one, leaving
    // the user with no window and no connection.
    const output = await runProcessWithOutput(
      'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        // RELAUNCH_ARG tells the elevated instance that the process it is
        // replacing is still alive, so it must not hand its startup back over
        // the cross-instance activation handshake.
        `$ErrorActionPreference='Stop'; try { Start-Process -FilePath '${escapedExePath}' -ArgumentList '${RELAUNCH_ARG}' -Verb RunAs | Out-Null; exit 0 } catch { exit 1 }`,
      ],
      { timeoutMs: 60000, windowsHide: true },
    );
    return output.code === 0;
  } catch {
    return false;
  }
}

/** True when the current process itself runs as uid 0 (Unix root). */
export function isProcessRoot(): boolean {
  return typeof process.getuid === 'function' && process.getuid() === 0;
}

/**
 * Resolves an absolute, executable `pkexec` path or `null` when PolicyKit is
 * not installed. `pkexec` is the graphical privilege-escalation front-end
 * (PolicyKit) — the Linux analogue of the Windows UAC prompt. Resolving to an
 * absolute path (instead of spawning the bare name) avoids executing a planted
 * `pkexec` from a writable `$PATH` entry.
 */
export function findPkexecPath(): string | null {
  if (process.platform !== 'linux') {
    return null;
  }
  const candidates = [
    '/usr/bin/pkexec',
    '/bin/pkexec',
    '/usr/local/bin/pkexec',
  ];
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (dir) {
      candidates.push(path.join(dir, 'pkexec'));
    }
  }
  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // Keep looking.
    }
  }
  return null;
}

/** Whether TUN elevation via PolicyKit is possible on this Linux host. */
export function isPkexecAvailable(): boolean {
  return findPkexecPath() !== null;
}

export interface XrayElevationContext {
  platform: NodeJS.Platform;
  mode: ConnectionMode;
  isRoot: boolean;
  pkexecAvailable: boolean;
}

/**
 * Decides whether the Xray process must be spawned with elevated privileges.
 * Only Linux TUN mode needs this: Xray creates the TUN device and installs
 * auto-routes, which require `CAP_NET_ADMIN`/root. When the app already runs as
 * root nothing is needed; Windows handles elevation by relaunching the whole
 * app under UAC instead (see {@link requestTunPrivilegesRelaunch}).
 */
export function shouldElevateXray(ctx: XrayElevationContext): boolean {
  return (
    ctx.platform === 'linux' &&
    ctx.mode === 'tun' &&
    !ctx.isRoot &&
    ctx.pkexecAvailable
  );
}

/**
 * Builds the `pkexec` command that runs Xray as root while keeping the GUI
 * unprivileged. A non-root parent cannot signal a root child, so the wrapper
 * ties Xray's lifetime to this process's stdin: a normal disconnect closes the
 * pipe explicitly and an app crash closes it via fd cleanup, and in both cases
 * the root wrapper reacts to EOF by terminating Xray. This avoids orphaning the
 * tunnel and avoids a second PolicyKit prompt on disconnect.
 */
export function buildElevatedXrayCommand(
  pkexecPath: string,
  binPath: string,
  configPath: string,
  assetPath: string,
): { command: string; args: string[] } {
  const wrapper = [
    'export XRAY_LOCATION_ASSET="$2"',
    '"$0" -c "$1" &',
    'xray_pid=$!',
    'terminate() { kill "$xray_pid" 2>/dev/null || true; }',
    'trap terminate TERM INT EXIT',
    // Block until the parent closes our stdin (disconnect or app exit), then
    // tear Xray down as root.
    'cat >/dev/null 2>&1 || true',
    'terminate',
    'wait "$xray_pid" 2>/dev/null || true',
  ].join('\n');
  return {
    command: pkexecPath,
    args: ['/bin/sh', '-c', wrapper, binPath, configPath, assetPath],
  };
}

/**
 * Cross-platform privilege check for TUN mode setup.
 * - Windows: Administrator rights.
 * - Linux: already root, or PolicyKit (`pkexec`) is available so the Xray
 *   process can be elevated on demand at connect time.
 * - macOS/other Unix: root privileges.
 */
export async function hasTunPrivileges(): Promise<boolean> {
  if (process.platform === 'win32') {
    return isElevatedOnWindows();
  }
  if (process.platform === 'linux') {
    return isProcessRoot() || isPkexecAvailable();
  }
  return isProcessRoot();
}

/**
 * Best-effort privilege escalation that relaunches the whole app elevated.
 * Only Windows uses this (UAC). Linux does not relaunch the GUI as root;
 * instead it elevates just the Xray process via `pkexec` at spawn time
 * (see {@link shouldElevateXray} / {@link buildElevatedXrayCommand}).
 */
export async function requestTunPrivilegesRelaunch(): Promise<boolean> {
  if (process.platform === 'win32') {
    return relaunchAsAdminOnWindows();
  }
  return false;
}
