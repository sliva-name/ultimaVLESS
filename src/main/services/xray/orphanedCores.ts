import path from 'path';
import { logger } from '@/main/services/LoggerService';
import {
  runProcessWithOutput,
  type CommandOutput,
} from '@/main/services/platform/commandRunner';
import { runPowerShell } from '@/main/services/tunRoute/powerShellRunner';
import { getBinResourcesPath } from '@/main/utils/runtimePaths';
import { getOwnedXrayPids } from './ownedProcesses';

const COMMAND_TIMEOUT_MS = 8000;
const SCRIPT_TIMEOUT_MS = 15000;

export interface OrphanedCoresOptions {
  platform?: NodeJS.Platform;
  run?: (command: string, args: string[]) => Promise<CommandOutput>;
  runScript?: (script: string) => Promise<string>;
  /** This installation's `xray.exe`. */
  binaryPath?: string;
  ownPids?: () => number[];
  selfPid?: number;
}

/** `tasklist /FO CSV /NH` rows: `"xray.exe","1234",...`; only the PID matters. */
function parsePids(output: string): number[] {
  const pids: number[] = [];
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s*"[^"]*","(\d+)"/.exec(line);
    if (match) pids.push(Number(match[1]));
  }
  return pids;
}

/**
 * Prints `pid|path` for those of `pids` that run in this app's Windows
 * session. A path is only readable for processes this user may query.
 */
function describeScript(selfPid: number, pids: number[]): string {
  return [
    `$session = (Get-Process -Id ${selfPid}).SessionId`,
    `$ids = @(${pids.join(',')})`,
    `Get-CimInstance Win32_Process -Filter "Name = 'xray.exe'" |`,
    '  Where-Object { $ids -contains $_.ProcessId -and $_.SessionId -eq $session -and $_.ExecutablePath } |',
    '  ForEach-Object { "$($_.ProcessId)|$($_.ExecutablePath)" }',
  ].join('\n');
}

/**
 * Stops Xray processes started from this installation's binary in this
 * Windows session but not by this instance: left by a crashed session, or
 * still stopping after the previous instance handed over to an elevated one.
 * Such a core keeps the local proxy ports, and the conflict scan would offer
 * to close it as another client's Xray. Runs at startup, before anything
 * connects. Xray's WFP filters live in a dynamic session, so a forced stop
 * takes them away too.
 */
export async function stopOrphanedXrayCores(
  options: OrphanedCoresOptions = {},
): Promise<number[]> {
  if ((options.platform ?? process.platform) !== 'win32') return [];
  const run =
    options.run ??
    ((command, args) =>
      runProcessWithOutput(command, args, {
        timeoutMs: COMMAND_TIMEOUT_MS,
        windowsHide: true,
      }));
  // Our own PIDs are read after the listing: a core is tracked the moment it
  // is spawned, so one the listing shows is already known by then (a startup
  // real-delay ping may start probes at any time).
  const ownPids = options.ownPids ?? getOwnedXrayPids;
  const listed = await run('tasklist', [
    '/FO',
    'CSV',
    '/NH',
    '/FI',
    'IMAGENAME eq xray.exe',
  ]);
  const ownAfterListing = new Set(ownPids());
  const candidates = parsePids(listed.stdout).filter(
    (pid) => !ownAfterListing.has(pid),
  );
  if (candidates.length === 0) return [];

  const runScript =
    options.runScript ??
    ((script) => runPowerShell(script, { timeoutMs: SCRIPT_TIMEOUT_MS }));
  const described = await runScript(
    describeScript(options.selfPid ?? process.pid, candidates),
  );
  const binary = path.win32
    .normalize(
      options.binaryPath ?? path.join(getBinResourcesPath(), 'xray.exe'),
    )
    .toLowerCase();
  const own = new Set(ownPids());
  const orphans: number[] = [];
  for (const line of described.split(/\r?\n/)) {
    const match = /^(\d+)\|(.+)$/.exec(line.trim());
    if (
      match &&
      !own.has(Number(match[1])) &&
      path.win32.normalize(match[2]).toLowerCase() === binary
    ) {
      orphans.push(Number(match[1]));
    }
  }
  if (orphans.length === 0) return [];

  await run('taskkill', [
    '/F',
    ...orphans.flatMap((pid) => ['/PID', String(pid)]),
  ]);
  logger.info('XrayService', 'Stopped Xray cores left by an earlier instance', {
    pids: orphans,
  });
  return orphans;
}
