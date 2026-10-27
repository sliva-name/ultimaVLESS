/**
 * Placeholder `fs`. Every module that does real file I/O is replaced by an
 * Android implementation; the ones left only touch files on code paths that
 * never run on Android (Linux IPv6 detection, desktop log rotation), so each
 * call reports a missing file.
 */

function missing(path: unknown): Error & { code: string } {
  const error = new Error(
    `ENOENT: no such file or directory, '${String(path)}'`,
  ) as Error & { code: string };
  error.code = 'ENOENT';
  return error;
}

export const constants = { F_OK: 0, R_OK: 4, W_OK: 2, X_OK: 1 };

export function existsSync(): boolean {
  return false;
}

export function readFileSync(path: unknown): never {
  throw missing(path);
}

export function statSync(path: unknown): never {
  throw missing(path);
}

export function mkdirSync(): void {}

export function writeFileSync(): void {}

export function appendFileSync(): void {}

export function unlinkSync(): void {}

export function renameSync(): void {}

const reject = (path: unknown) => Promise.reject(missing(path));

export const promises = {
  access: reject,
  stat: reject,
  readFile: reject,
  open: reject,
  writeFile: () => Promise.resolve(),
  appendFile: () => Promise.resolve(),
  mkdir: () => Promise.resolve(),
  unlink: () => Promise.resolve(),
};

export default {
  constants,
  existsSync,
  readFileSync,
  statSync,
  mkdirSync,
  writeFileSync,
  appendFileSync,
  unlinkSync,
  renameSync,
  promises,
};
