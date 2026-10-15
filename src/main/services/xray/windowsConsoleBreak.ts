import {
  runProcessWithOutput,
  type CommandOutput,
} from '@/main/services/platform/commandRunner';

/**
 * Graceful Xray shutdown on Windows.
 *
 * `child.kill()` is TerminateProcess there, so Xray never runs `server.Close()`
 * and its TUN inbound never reaches `WintunCloseAdapter`: the adapter is torn
 * down by PnP after the process is gone instead of being closed and removed
 * by Wintun. Go maps Ctrl+Break to `os.Interrupt`, which Xray waits for
 * before closing every inbound, so a Ctrl+Break in Xray's console is the
 * same clean stop as Ctrl+C in a terminal.
 *
 * Node cannot raise console events, and only a process attached to the
 * target's console can. A short-lived PowerShell helper attaches to Xray's
 * console (Xray must be spawned with `windowsHide`, so the console is its own
 * and the event reaches nobody else), ignores the event itself and raises
 * Ctrl+Break. Ctrl+C is not used: a process started with Ctrl+C disabled
 * passes that flag on to its children, and Xray would ignore it.
 */

export type ConsoleBreakRunner = (
  command: string,
  args: string[],
) => Promise<CommandOutput>;

/** PowerShell startup plus Add-Type compilation; generous for slow disks. */
export const CONSOLE_BREAK_HELPER_TIMEOUT_MS = 4_000;

const defaultRunner: ConsoleBreakRunner = (command, args) =>
  runProcessWithOutput(command, args, {
    timeoutMs: CONSOLE_BREAK_HELPER_TIMEOUT_MS,
    windowsHide: true,
  });

/**
 * Exit codes: 0 — event raised; 3 — the PID is no longer an Xray process
 * (it exited and the PID was reused); 4 — cannot attach to its console;
 * 5 — the event could not be raised.
 */
export function buildConsoleBreakScript(
  pid: number,
  processName: string,
): string {
  const encodedName = Buffer.from(processName, 'utf8').toString('base64');
  return [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -TypeDefinition @'",
    'using System;',
    'using System.Diagnostics;',
    'using System.Runtime.InteropServices;',
    'public static class UltimaConsoleBreak {',
    '  public delegate bool HandlerRoutine(uint ctrlType);',
    '  [DllImport("kernel32.dll", SetLastError = true)] static extern bool FreeConsole();',
    '  [DllImport("kernel32.dll", SetLastError = true)] static extern bool AttachConsole(uint processId);',
    '  [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetConsoleCtrlHandler(HandlerRoutine handler, bool add);',
    '  [DllImport("kernel32.dll", SetLastError = true)] static extern bool GenerateConsoleCtrlEvent(uint ctrlEvent, uint processGroupId);',
    '  static readonly HandlerRoutine Ignore = ctrlType => true;',
    '  public static int Send(uint pid, string processName) {',
    '    using (var target = Process.GetProcessById((int)pid)) {',
    '      if (!string.Equals(target.ProcessName, processName, StringComparison.OrdinalIgnoreCase)) return 3;',
    '    }',
    '    FreeConsole();',
    '    if (!AttachConsole(pid)) return 4;',
    '    SetConsoleCtrlHandler(Ignore, true);',
    '    if (!GenerateConsoleCtrlEvent(1, 0)) return 5;',
    '    System.Threading.Thread.Sleep(100);',
    '    return 0;',
    '  }',
    '}',
    "'@",
    `$name = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedName}'))`,
    `exit [UltimaConsoleBreak]::Send(${pid}, $name)`,
  ].join('\n');
}

/**
 * Raises Ctrl+Break in the console of `pid`. Resolves true when the event was
 * delivered; never rejects. The caller still owns the hard-kill fallback.
 */
export async function sendConsoleBreak(
  pid: number,
  options: { processName?: string; run?: ConsoleBreakRunner } = {},
): Promise<boolean> {
  if (process.platform !== 'win32' || !Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  const script = buildConsoleBreakScript(pid, options.processName ?? 'xray');
  const run = options.run ?? defaultRunner;
  try {
    const output = await run('powershell', [
      '-NoLogo',
      '-NonInteractive',
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64'),
    ]);
    return output.code === 0;
  } catch {
    return false;
  }
}
