import { app } from 'electron';
import { classifyAppEntry, type AppOption } from '@/shared/appRouting';
import { runPowerShell } from './tunRoute/powerShellRunner';

const LIST_TIMEOUT_MS = 8000;

/**
 * `Path` is only readable for processes this user may query, which is the set
 * worth offering anyway. The name is taken from the path rather than the
 * process image name: Xray reads it the same way (QueryFullProcessImageName),
 * and the image name can differ in case (`claude.exe` for `Claude.exe`).
 */
const LIST_SCRIPT =
  'Get-Process | Where-Object { $_.Path } | Select-Object Path, Description -Unique | ConvertTo-Json -Compress';

export type AppIconLoader = (path: string) => Promise<string | null>;

export interface RunningAppsOptions {
  platform?: NodeJS.Platform;
  runScript?: (script: string) => Promise<string>;
  getIcon?: AppIconLoader;
  systemRoot?: string;
}

interface ProcessRow {
  path: string;
  description: string | null;
}

async function readFileIcon(path: string): Promise<string | null> {
  try {
    const image = await app.getFileIcon(path, { size: 'normal' });
    return image.isEmpty() ? null : image.toDataURL();
  } catch {
    return null;
  }
}

/** Icons never change for a given file, so each is extracted once. */
function cachedIconLoader(load: AppIconLoader): AppIconLoader {
  const cache = new Map<string, Promise<string | null>>();
  return (path) => {
    const key = path.toLowerCase();
    let icon = cache.get(key);
    if (!icon) {
      icon = load(path);
      cache.set(key, icon);
    }
    return icon;
  };
}

const defaultIconLoader = cachedIconLoader(readFileIcon);

/** `ConvertTo-Json` emits a bare object when only one process matched. */
export function parseProcessList(stdout: string): ProcessRow[] {
  const text = stdout.trim();
  if (text.length === 0) return [];
  const parsed: unknown = JSON.parse(text);
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  const out: ProcessRow[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const { Path: path, Description: description } = row as Record<
      string,
      unknown
    >;
    if (typeof path !== 'string' || path.length === 0) continue;
    out.push({
      path,
      description:
        typeof description === 'string' && description.trim().length > 0
          ? description.trim()
          : null,
    });
  }
  return out;
}

function resolveSystemRoot(options: RunningAppsOptions): string {
  return (options.systemRoot ?? process.env.SystemRoot ?? 'C:\\Windows')
    .replace(/[\\/]+$/, '')
    .toLowerCase();
}

/** Describes an executable by its full path, or null if it has no usable name. */
export async function describeExecutable(
  path: string,
  description: string | null,
  options: RunningAppsOptions = {},
): Promise<AppOption | null> {
  const name = classifyAppEntry(path);
  if (!name) return null;
  const getIcon = options.getIcon ?? defaultIconLoader;
  const normalizedPath = path.replace(/^\\\\\?\\/, '').toLowerCase();
  return {
    name,
    description,
    icon: await getIcon(path),
    system: normalizedPath.startsWith(`${resolveSystemRoot(options)}\\`),
  };
}

function sortKey(option: AppOption): string {
  return option.description ?? option.name;
}

/**
 * Running programs for the app routing picker: one entry per executable name,
 * the user's own programs first, then Windows components. Windows only — on
 * Linux/macOS the picker falls back to the file dialog and typed names.
 */
export async function listRunningApps(
  options: RunningAppsOptions = {},
): Promise<AppOption[]> {
  const platform = options.platform ?? process.platform;
  if (platform !== 'win32') return [];
  const runScript =
    options.runScript ??
    ((script: string) => runPowerShell(script, { timeoutMs: LIST_TIMEOUT_MS }));

  const byName = new Map<string, ProcessRow>();
  for (const row of parseProcessList(await runScript(LIST_SCRIPT))) {
    const name = classifyAppEntry(row.path);
    if (!name) continue;
    const known = byName.get(name);
    if (!known) byName.set(name, row);
    else if (!known.description && row.description)
      known.description = row.description;
  }

  const apps = await Promise.all(
    [...byName.values()].map((row) =>
      describeExecutable(row.path, row.description, options),
    ),
  );
  return apps
    .filter((option): option is AppOption => option !== null)
    .sort(
      (a, b) =>
        Number(a.system) - Number(b.system) ||
        sortKey(a).localeCompare(sortKey(b), 'en', { sensitivity: 'base' }),
    );
}
