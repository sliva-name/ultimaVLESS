/** POSIX `path`: Android file paths only. */

export const sep = '/';

export function normalize(input: string): string {
  const absolute = input.startsWith('/');
  const parts: string[] = [];
  for (const part of input.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (parts.length > 0 && parts[parts.length - 1] !== '..') parts.pop();
      else if (!absolute) parts.push('..');
      continue;
    }
    parts.push(part);
  }
  const joined = parts.join('/');
  const trailing = input.endsWith('/') && joined ? '/' : '';
  return absolute ? `/${joined}${trailing}` : `${joined || '.'}${trailing}`;
}

export function join(...segments: string[]): string {
  return normalize(segments.filter(Boolean).join('/'));
}

export function resolve(...segments: string[]): string {
  let result = '';
  for (const segment of segments) {
    if (!segment) continue;
    result = segment.startsWith('/') ? segment : `${result}/${segment}`;
  }
  return normalize(result.startsWith('/') ? result : `/${result}`);
}

/** Normalized, without the trailing slash `join` keeps. */
function trimmed(input: string): string {
  return normalize(input).replace(/(.)\/$/, '$1');
}

export function dirname(input: string): string {
  const normalized = trimmed(input);
  const index = normalized.lastIndexOf('/');
  if (index === -1) return '.';
  return index === 0 ? '/' : normalized.slice(0, index);
}

export function basename(input: string, ext?: string): string {
  const base = trimmed(input).split('/').pop() ?? '';
  return ext && base.endsWith(ext) ? base.slice(0, -ext.length) : base;
}

export function extname(input: string): string {
  const base = basename(input);
  const index = base.lastIndexOf('.');
  return index <= 0 ? '' : base.slice(index);
}

const path = { sep, normalize, join, resolve, dirname, basename, extname };

export const posix = path;

export default { ...path, posix };
