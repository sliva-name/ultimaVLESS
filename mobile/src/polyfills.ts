import { Buffer } from 'buffer';

/**
 * Globals the desktop main-process modules read: `process` (platform checks,
 * env flags) and `Buffer` (Base64 share links). Imported before anything else.
 */
const globals = globalThis as unknown as {
  process?: Partial<NodeJS.Process>;
  Buffer?: typeof Buffer;
};

globals.process ??= {
  platform: 'android',
  arch: 'arm64',
  argv: [],
  env: {},
  versions: {} as NodeJS.ProcessVersions,
  cwd: () => '/',
} as Partial<NodeJS.Process>;
globals.Buffer ??= Buffer;
