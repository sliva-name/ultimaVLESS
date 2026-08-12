import fs from 'fs';

/**
 * Deletes a file, tolerating its absence.
 *
 * `fs.rmSync(file, { force: true })` has been observed to silently do nothing on
 * some Windows builds — it neither removes the file nor raises an error, which
 * would leave artifacts such as the legacy proxy script sitting in a
 * user-writable directory. `unlinkSync` reports what actually happened.
 */
export function removeFileSync(filePath: string): void {
  try {
    fs.unlinkSync(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
}
