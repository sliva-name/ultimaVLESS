import { classifyAppEntry } from '@/shared/appRouting';
import { parseTasklistCsv } from './ConflictingAppsService';
import {
  runProcessWithOutput,
  type CommandOutput,
} from './platform/commandRunner';

const TASKLIST_TIMEOUT_MS = 8000;

export interface ListRunningAppsOptions {
  platform?: NodeJS.Platform;
  run?: (command: string, args: string[]) => Promise<CommandOutput>;
}

/**
 * Executable names of running processes, offered as suggestions by the app
 * routing picker so a typed name gets the exact spelling Xray compares
 * against. Windows only: `tasklist` reports the image file name the `process`
 * rule sees, while `ps` on Linux/macOS gives truncated `comm` names. Kernel
 * pseudo-processes (`System`, `Registry`) have no `.exe` and are skipped.
 */
export async function listRunningApps(
  options: ListRunningAppsOptions = {},
): Promise<string[]> {
  const platform = options.platform ?? process.platform;
  if (platform !== 'win32') return [];
  const run =
    options.run ??
    ((command, args) =>
      runProcessWithOutput(command, args, {
        timeoutMs: TASKLIST_TIMEOUT_MS,
        windowsHide: true,
      }));

  const output = await run('tasklist', ['/FO', 'CSV', '/NH']);
  const names = new Set<string>();
  for (const { image } of parseTasklistCsv(output.stdout)) {
    if (!/\.exe$/i.test(image)) continue;
    const entry = classifyAppEntry(image);
    if (entry) names.add(entry);
  }
  return [...names].sort((a, b) =>
    a.localeCompare(b, 'en', { sensitivity: 'base' }),
  );
}
