/**
 * Per-application routing: executables whose connections are tunnelled or sent
 * direct regardless of the destination. Entries become Xray `process` rule
 * matchers, which look up the process owning the connection in the OS socket
 * table (Windows `GetExtendedTcpTable`, Linux `/proc/net`).
 *
 * Only bare file names are stored (`chrome.exe`, `firefox`). Xray matches them
 * against the executable name with `.exe` dropped, so the rule keeps working
 * when an update moves the program to a new versioned folder (Discord,
 * Telegram). The comparison is case-sensitive, which is why the picker reads
 * the name from the file system instead of relying on what the user typed.
 * @see https://xtls.github.io/config/routing.html
 */

export const MAX_APP_ROUTING_ENTRIES = 100;

/** An executable the app picker offers, as main reads it from the system. */
export interface AppOption {
  /** File name spelled the way Xray's `process` rule sees it. */
  name: string;
  /** Version-resource description (`Google Chrome`), when the file has one. */
  description: string | null;
  /** PNG data URL of the file icon, or null when it could not be read. */
  icon: string | null;
  /** Lives under the Windows directory (`explorer.exe`, `svchost.exe`). */
  system: boolean;
}
const MAX_APP_NAME_LENGTH = 255;
// eslint-disable-next-line no-control-regex
const FORBIDDEN_NAME_CHARS = /[\u0000-\u001f\u007f<>:"|?*]/;

/**
 * Turns a typed name or a full path into a stored entry, or null when it
 * cannot name an executable. Paths are reduced to the file name: Xray reads
 * `/` as a path or folder matcher, and `self/` / `xray/` as its own process.
 */
export function classifyAppEntry(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  let name = input.trim();
  // Explorer's "Copy as path" wraps the path in quotes.
  if (name.length >= 2 && name.startsWith('"') && name.endsWith('"')) {
    name = name.slice(1, -1).trim();
  }
  name = (name.split(/[\\/]/).pop() ?? '').trim();
  if (name.length === 0 || name.length > MAX_APP_NAME_LENGTH) return null;
  if (FORBIDDEN_NAME_CHARS.test(name)) return null;
  if (/^\.+$/.test(name)) return null;
  // Xray strips a lowercase `.exe` from both sides before comparing.
  if (/\.exe$/i.test(name)) {
    const stem = name.slice(0, -'.exe'.length);
    if (stem.length === 0) return null;
    name = `${stem}.exe`;
  }
  return name;
}

export function normalizeAppEntries(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const raw of value) {
    const entry = classifyAppEntry(raw);
    if (!entry || out.includes(entry)) continue;
    out.push(entry);
    if (out.length >= MAX_APP_ROUTING_ENTRIES) break;
  }
  return out;
}

/**
 * Restores the on-disk spelling of a typed name from a list of known
 * executables (e.g. running processes), since Xray compares names
 * case-sensitively.
 */
export function matchKnownAppName(
  entry: string,
  known: readonly string[],
): string {
  if (known.includes(entry)) return entry;
  const lower = entry.toLowerCase();
  const withExe = lower.endsWith('.exe') ? lower : `${lower}.exe`;
  return (
    known.find((name) => name.toLowerCase() === lower) ??
    known.find((name) => name.toLowerCase() === withExe) ??
    entry
  );
}
