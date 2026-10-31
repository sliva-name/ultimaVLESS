import fs from 'fs';
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
 * (PolicyKit) — the Linux analogue of the Windows UAC prompt. Only well-known
 * system locations are considered: a planted `pkexec` on `$PATH` (or in the
 * current working directory) must never run as root.
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
 * Exit codes of the root wrapper itself. Xray exits with 0, 1, 2 or 23, and
 * pkexec reports a failed or dismissed authorization as 126/127.
 */
export const ELEVATED_WRAPPER_EXIT = {
  /** The root-owned copy of Xray could not be made. */
  COPY_FAILED: 90,
  /** That copy does not match the binary shipped with the app. */
  CHECKSUM_MISMATCH: 91,
  /** sh could not execute Xray (its own 126/127, remapped). */
  EXEC_FAILED: 92,
} as const;

/** Why the root wrapper gave up, or `null` for any other exit code. */
export function describeElevatedWrapperExit(
  code: number | null,
): string | null {
  switch (code) {
    case ELEVATED_WRAPPER_EXIT.COPY_FAILED:
      return 'TUN mode could not make a root-owned copy of Xray';
    case ELEVATED_WRAPPER_EXIT.CHECKSUM_MISMATCH:
      return 'TUN mode refused to run Xray: its copy does not match the one shipped with UltimaVLESS';
    case ELEVATED_WRAPPER_EXIT.EXEC_FAILED:
      return 'TUN mode could not run Xray as root';
    default:
      return null;
  }
}

/**
 * Builds the `pkexec` command that runs Xray as root while keeping the GUI
 * unprivileged. A non-root parent cannot signal a root child, so the wrapper
 * ties Xray's lifetime to this process's stdin: a normal disconnect closes the
 * pipe explicitly and an app crash closes it via fd cleanup, and in both cases
 * the root wrapper reacts to EOF by terminating Xray. This avoids orphaning the
 * tunnel and avoids a second PolicyKit prompt on disconnect. The wrapper also
 * exits as soon as Xray does, with Xray's exit code, so a core that fails to
 * start is reported at once instead of after the readiness timeout.
 *
 * With `binSha256`, `binPath` is a copy the user can rewrite (see
 * `prepareElevatedCore`): root copies it into a directory of its own and runs
 * it only if the copy matches the shipped binary.
 */
export function buildElevatedXrayCommand(
  pkexecPath: string,
  binPath: string,
  configPath: string,
  assetPath: string,
  binSha256: string | null = null,
): { command: string; args: string[] } {
  const { COPY_FAILED, CHECKSUM_MISMATCH, EXEC_FAILED } = ELEVATED_WRAPPER_EXIT;
  const wrapper = [
    // fd 3 keeps the parent's pipe: background jobs get /dev/null as stdin.
    'exec 3<&0',
    'xray="$0"',
    "private=''",
    'if [ -n "$3" ]; then',
    `  private=$(mktemp -d) || exit ${COPY_FAILED}`,
    '  if ! cp "$0" "$private/xray" || ! chmod 700 "$private/xray"; then',
    '    rm -rf "$private"',
    `    exit ${COPY_FAILED}`,
    '  fi',
    '  if [ "$(sha256sum "$private/xray" | cut -d " " -f 1)" != "$3" ]; then',
    '    rm -rf "$private"',
    `    exit ${CHECKSUM_MISMATCH}`,
    '  fi',
    '  xray="$private/xray"',
    'fi',
    'export XRAY_LOCATION_ASSET="$2"',
    '"$xray" -c "$1" 3<&- &',
    'xray_pid=$!',
    // Reads until the parent closes our stdin (disconnect or app exit), then
    // tears Xray down as root.
    '{ while read -r _; do :; done; kill "$xray_pid"; } <&3 >/dev/null 2>&1 &',
    'watcher_pid=$!',
    'exec 3<&-',
    'trap \'kill "$xray_pid" 2>/dev/null\' HUP INT TERM',
    'wait "$xray_pid"',
    'status=$?',
    'kill "$watcher_pid" 2>/dev/null',
    'if [ -n "$private" ]; then rm -rf "$private"; fi',
    // pkexec uses 126/127 for authorization failures.
    `case "$status" in 126|127) status=${EXEC_FAILED} ;; esac`,
    'exit "$status"',
  ].join('\n');
  return {
    command: pkexecPath,
    args: [
      '/bin/sh',
      '-c',
      wrapper,
      binPath,
      configPath,
      assetPath,
      binSha256 ?? '',
    ],
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
