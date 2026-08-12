import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  activateRunningInstance,
  consumeActivationRequest,
  isProcessAlive,
  readLiveOwner,
  startInstanceActivationService,
  stopInstanceActivationService,
} from './instanceActivation';

let userDataDir: string;

const ownerPath = () => path.join(userDataDir, 'instance-owner.json');
const requestPath = () => path.join(userDataDir, 'activate-request.json');

beforeEach(() => {
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ultima-activation-'));
});

afterEach(() => {
  stopInstanceActivationService(userDataDir);
  fs.rmSync(userDataDir, { recursive: true, force: true });
});

describe('readLiveOwner', () => {
  it('ignores a missing, unreadable or stale record', () => {
    expect(readLiveOwner(userDataDir)).toBeNull();

    fs.writeFileSync(ownerPath(), 'not json', 'utf8');
    expect(readLiveOwner(userDataDir)).toBeNull();

    fs.writeFileSync(
      ownerPath(),
      JSON.stringify({ pid: 999999, updatedAt: Date.now() - 60_000 }),
      'utf8',
    );
    expect(readLiveOwner(userDataDir)).toBeNull();
  });

  it('ignores a fresh record whose process is gone', () => {
    fs.writeFileSync(
      ownerPath(),
      JSON.stringify({ pid: 0x7ffffffe, updatedAt: Date.now() }),
      'utf8',
    );
    expect(readLiveOwner(userDataDir)).toBeNull();
  });
});

describe('isProcessAlive', () => {
  it('treats the current process as not activatable and rejects junk pids', () => {
    expect(isProcessAlive(process.pid)).toBe(false);
    expect(isProcessAlive(0)).toBe(false);
    expect(isProcessAlive(-1)).toBe(false);
    expect(isProcessAlive(1.5)).toBe(false);
  });
});

describe('activateRunningInstance', () => {
  it('does not ask when no live instance published a heartbeat', async () => {
    await expect(activateRunningInstance(userDataDir)).resolves.toBe(false);
    expect(fs.existsSync(requestPath())).toBe(false);
  });

  it('reports failure and clears its request when nobody acknowledges', async () => {
    // A live pid this process is allowed to see: the parent is a safe stand-in.
    const livePid = process.ppid;
    fs.writeFileSync(
      ownerPath(),
      JSON.stringify({ pid: livePid, updatedAt: Date.now() }),
      'utf8',
    );

    await expect(activateRunningInstance(userDataDir)).resolves.toBe(false);
    expect(fs.existsSync(requestPath())).toBe(false);
  });
});

describe('consumeActivationRequest', () => {
  it('acknowledges by deleting the request and activates once', () => {
    const onActivate = vi.fn();
    fs.writeFileSync(
      requestPath(),
      JSON.stringify({ requestedAt: Date.now(), pid: 4242 }),
      'utf8',
    );

    consumeActivationRequest(userDataDir, onActivate);
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(requestPath())).toBe(false);

    consumeActivationRequest(userDataDir, onActivate);
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it('drops a request left behind by a launch that gave up', () => {
    const onActivate = vi.fn();
    fs.writeFileSync(
      requestPath(),
      JSON.stringify({ requestedAt: Date.now() - 120_000, pid: 4242 }),
      'utf8',
    );

    consumeActivationRequest(userDataDir, onActivate);
    expect(onActivate).not.toHaveBeenCalled();
    expect(fs.existsSync(requestPath())).toBe(false);
  });
});

describe('startInstanceActivationService', () => {
  it('publishes this process as the owner and discards pending requests', () => {
    fs.writeFileSync(
      requestPath(),
      JSON.stringify({ requestedAt: Date.now(), pid: 4242 }),
      'utf8',
    );

    const onActivate = vi.fn();
    startInstanceActivationService(userDataDir, onActivate);

    expect(JSON.parse(fs.readFileSync(ownerPath(), 'utf8')).pid).toBe(
      process.pid,
    );
    expect(fs.existsSync(requestPath())).toBe(false);
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('leaves a replacement owner record in place on shutdown', () => {
    startInstanceActivationService(userDataDir, vi.fn());
    fs.writeFileSync(
      ownerPath(),
      JSON.stringify({ pid: process.pid + 1, updatedAt: Date.now() }),
      'utf8',
    );

    stopInstanceActivationService(userDataDir);

    expect(fs.existsSync(ownerPath())).toBe(true);
  });
});
