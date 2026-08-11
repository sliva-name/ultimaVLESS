import path from 'path';

/**
 * Absolute paths to the Windows tools this app shells out to.
 *
 * Spawning `powershell` (or `taskkill`, `reg`, ...) by bare name makes Windows
 * search the executable's directory and the current working directory before
 * `%PATH%`, and `%PATH%` itself may contain a user-writable entry. Since parts
 * of the app run elevated (TUN mode requires Administrator), a planted
 * `powershell.exe` would execute with those privileges. Resolving through
 * `%SystemRoot%` removes the search entirely.
 *
 * @see https://learn.microsoft.com/windows/win32/api/processthreadsapi/nf-processthreadsapi-createprocessw
 */
function systemRoot(): string {
  return process.env.SystemRoot || process.env.windir || 'C:\\Windows';
}

function system32(binary: string): string {
  return path.join(systemRoot(), 'System32', binary);
}

export function powerShellPath(): string {
  return path.join(
    systemRoot(),
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
}

/** Bare command name (lowercased, with or without `.exe`) -> absolute path. */
const WINDOWS_SYSTEM_BINARIES: Record<string, () => string> = {
  powershell: powerShellPath,
  cmd: () => system32('cmd.exe'),
  netsh: () => system32('netsh.exe'),
  reg: () => system32('reg.exe'),
  route: () => system32('route.exe'),
  schtasks: () => system32('schtasks.exe'),
  taskkill: () => system32('taskkill.exe'),
  wscript: () => system32('wscript.exe'),
};

/**
 * Maps a bare Windows system command to its absolute path. Anything already
 * absolute, unknown, or running on another platform is returned unchanged.
 */
export function resolveSystemBinary(command: string): string {
  if (process.platform !== 'win32') return command;
  if (path.isAbsolute(command)) return command;
  if (command.includes('/') || command.includes('\\')) return command;

  const key = command.toLowerCase().replace(/\.exe$/, '');
  const resolver = WINDOWS_SYSTEM_BINARIES[key];
  return resolver ? resolver() : command;
}
