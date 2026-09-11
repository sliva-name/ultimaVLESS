import fs from 'fs';

/**
 * Shifts `file` → `file.1` → … → `file.<maxBackups>` (the oldest backup is
 * dropped). A missing or empty `file` is left alone and the backups are not
 * touched, so a session that logged nothing does not push history out.
 *
 * Synchronous on purpose: it runs once at startup before anything writes, and
 * on Windows a rename must not interleave with appends from the same process.
 */
export function rotateFileSync(filePath: string, maxBackups: number): boolean {
  let size: number;
  try {
    size = fs.statSync(filePath).size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
  if (size === 0) {
    return false;
  }

  for (let index = maxBackups; index >= 1; index -= 1) {
    const from = index === 1 ? filePath : `${filePath}.${index - 1}`;
    const to = `${filePath}.${index}`;
    if (!fs.existsSync(from)) {
      continue;
    }
    if (fs.existsSync(to)) {
      fs.unlinkSync(to);
    }
    fs.renameSync(from, to);
  }
  return true;
}
