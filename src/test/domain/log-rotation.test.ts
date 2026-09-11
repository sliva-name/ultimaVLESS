import fs from 'fs';
import os from 'os';
import path from 'path';
import { app } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rotateFileSync } from '@/main/utils/logRotation';
import { LoggerService } from '@/main/services/LoggerService';

// The logger resolves its directory from `app.getPath('logs')` at construction;
// point it at a scratch directory instead of the setup-wide `/tmp` stub.
vi.mock('electron', async () => {
  const fsModule = await import('fs');
  const osModule = await import('os');
  const pathModule = await import('path');
  const dir = fsModule.mkdtempSync(
    pathModule.join(osModule.tmpdir(), 'ultima-logger-'),
  );
  return {
    app: {
      getPath: vi.fn(() => dir),
      isPackaged: false,
    },
  };
});

const logDir = app.getPath('logs');
let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ultima-rotate-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  for (const entry of fs.readdirSync(logDir)) {
    fs.rmSync(path.join(logDir, entry), { force: true });
  }
});

describe('rotateFileSync', () => {
  it('shifts the current file into numbered backups and drops the oldest', () => {
    const file = path.join(tmpDir, 'app.log');
    fs.writeFileSync(file, 'session-3');
    fs.writeFileSync(`${file}.1`, 'session-2');
    fs.writeFileSync(`${file}.2`, 'session-1');

    expect(rotateFileSync(file, 2)).toBe(true);

    expect(fs.existsSync(file)).toBe(false);
    expect(fs.readFileSync(`${file}.1`, 'utf8')).toBe('session-3');
    expect(fs.readFileSync(`${file}.2`, 'utf8')).toBe('session-2');
    expect(fs.existsSync(`${file}.3`)).toBe(false);
  });

  it('leaves everything alone for a missing or empty file', () => {
    const file = path.join(tmpDir, 'app.log');
    fs.writeFileSync(`${file}.1`, 'previous');

    expect(rotateFileSync(file, 2)).toBe(false);
    fs.writeFileSync(file, '');
    expect(rotateFileSync(file, 2)).toBe(false);

    expect(fs.readFileSync(`${file}.1`, 'utf8')).toBe('previous');
  });
});

describe('LoggerService sessions', () => {
  it('buffers until beginSession, then rotates the previous session out', async () => {
    const logPath = path.join(logDir, 'app.log');
    fs.writeFileSync(logPath, '{"message":"previous session"}\n');
    const logger = new LoggerService('app.log');

    logger.info('Test', 'first');
    logger.info('Test', 'second');
    // Nothing committed yet: the previous session's file is untouched.
    expect(fs.readFileSync(logPath, 'utf8')).toBe(
      '{"message":"previous session"}\n',
    );

    logger.beginSession();
    await logger.flush();

    expect(fs.readFileSync(`${logPath}.1`, 'utf8')).toBe(
      '{"message":"previous session"}\n',
    );
    const lines = fs
      .readFileSync(logPath, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { message: string });
    expect(lines.map((line) => line.message)).toEqual([
      '[INFO] first',
      '[INFO] second',
    ]);
  });

  it('flush without beginSession appends to the current file without rotating', async () => {
    const logPath = path.join(logDir, 'app.log');
    fs.writeFileSync(logPath, '{"message":"primary instance"}\n');
    const logger = new LoggerService('app.log');

    logger.info('Duplicate', 'handing over');
    await logger.flush();

    expect(fs.existsSync(`${logPath}.1`)).toBe(false);
    const content = fs.readFileSync(logPath, 'utf8');
    expect(content.startsWith('{"message":"primary instance"}\n')).toBe(true);
    expect(content).toContain('handing over');
  });
});
