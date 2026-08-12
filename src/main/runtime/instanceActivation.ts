import fs from 'fs';
import path from 'path';
import { logger } from '@/main/services/LoggerService';
import { removeFileSync } from '@/main/utils/removeFile';

/**
 * Electron's single-instance lock is delivered through a hidden message window
 * (`WM_COPYDATA`). UIPI blocks a medium-integrity process from posting to a
 * window owned by an elevated one, so when UltimaVLESS runs as Administrator
 * (TUN mode relaunches itself that way) a desktop-shortcut launch never reaches
 * the running app: it acquires the lock itself and starts a duplicate.
 *
 * Files under `userData` are readable and writable across integrity levels for
 * the same user, so a marker file plus a request file is a handshake that keeps
 * working. The running instance publishes a heartbeat; a newly started process
 * finds it, asks for the window, waits for the acknowledgement (the request file
 * being consumed) and only then exits.
 */

const OWNER_FILE = 'instance-owner.json';
const REQUEST_FILE = 'activate-request.json';
const HEARTBEAT_INTERVAL_MS = 5_000;
/** Heartbeats older than this belong to a crashed instance. */
const OWNER_STALE_AFTER_MS = 20_000;
const REQUEST_POLL_INTERVAL_MS = 250;
/** Requests left behind by a process that gave up waiting are not replayed. */
const REQUEST_MAX_AGE_MS = 30_000;
const ACK_TIMEOUT_MS = 3_000;
const ACK_POLL_INTERVAL_MS = 100;

interface OwnerRecord {
  pid: number;
  updatedAt: number;
}

let heartbeatTimer: NodeJS.Timeout | null = null;
let requestPollTimer: NodeJS.Timeout | null = null;

function ownerFilePath(userDataDir: string): string {
  return path.join(userDataDir, OWNER_FILE);
}

function requestFilePath(userDataDir: string): string {
  return path.join(userDataDir, REQUEST_FILE);
}

function readJsonFile(filePath: string): Record<string, unknown> | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * `process.kill(pid, 0)` needs PROCESS_TERMINATE on Windows, which an elevated
 * target denies — `EPERM` therefore means "alive but out of reach", which is
 * exactly the case this handshake exists for.
 */
export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export function readLiveOwner(
  userDataDir: string,
  now: number = Date.now(),
): OwnerRecord | null {
  const parsed = readJsonFile(ownerFilePath(userDataDir));
  if (!parsed) return null;

  const pid = typeof parsed.pid === 'number' ? parsed.pid : NaN;
  const updatedAt =
    typeof parsed.updatedAt === 'number' ? parsed.updatedAt : NaN;
  if (!Number.isFinite(updatedAt)) return null;
  // A clock jump backwards must not resurrect a stale record either.
  if (Math.abs(now - updatedAt) > OWNER_STALE_AFTER_MS) return null;
  if (!isProcessAlive(pid)) return null;

  return { pid, updatedAt };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Asks an already running instance to bring its window up.
 * Returns false when no live instance answered, in which case the caller must
 * start normally — quitting on an unacknowledged request would leave the user
 * with no window at all.
 */
export async function activateRunningInstance(
  userDataDir: string,
): Promise<boolean> {
  const owner = readLiveOwner(userDataDir);
  if (!owner) return false;

  const requestPath = requestFilePath(userDataDir);
  try {
    fs.writeFileSync(
      requestPath,
      JSON.stringify({ requestedAt: Date.now(), pid: process.pid }),
      'utf8',
    );
  } catch (error) {
    logger.warn('InstanceActivation', 'Could not write activation request', {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }

  const deadline = Date.now() + ACK_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await delay(ACK_POLL_INTERVAL_MS);
    if (!fs.existsSync(requestPath)) {
      logger.info('InstanceActivation', 'Running instance took over the window', {
        ownerPid: owner.pid,
      });
      return true;
    }
  }

  // Unanswered: drop the request so the other instance cannot pop a window
  // minutes later, and let this process boot as usual.
  clearPendingActivationRequest(userDataDir);
  logger.warn('InstanceActivation', 'Running instance did not acknowledge', {
    ownerPid: owner.pid,
  });
  return false;
}

function writeOwnerRecord(userDataDir: string): void {
  try {
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.writeFileSync(
      ownerFilePath(userDataDir),
      JSON.stringify({ pid: process.pid, updatedAt: Date.now() }),
      'utf8',
    );
  } catch (error) {
    logger.warn('InstanceActivation', 'Could not publish instance heartbeat', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function clearPendingActivationRequest(userDataDir: string): void {
  try {
    removeFileSync(requestFilePath(userDataDir));
  } catch {
    // Best effort only.
  }
}

/** Consumes a pending request; deleting the file is the acknowledgement. */
export function consumeActivationRequest(
  userDataDir: string,
  onActivate: () => void,
  now: number = Date.now(),
): void {
  const requestPath = requestFilePath(userDataDir);
  const parsed = readJsonFile(requestPath);
  if (!parsed) {
    // Either nothing pending, or unreadable garbage that must not linger.
    if (fs.existsSync(requestPath)) {
      clearPendingActivationRequest(userDataDir);
    }
    return;
  }

  try {
    removeFileSync(requestPath);
  } catch (error) {
    logger.warn('InstanceActivation', 'Could not clear activation request', {
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  const requestedAt =
    typeof parsed.requestedAt === 'number' ? parsed.requestedAt : NaN;
  if (!Number.isFinite(requestedAt) || now - requestedAt > REQUEST_MAX_AGE_MS) {
    return;
  }

  logger.info('InstanceActivation', 'Activation requested by another launch', {
    requesterPid: typeof parsed.pid === 'number' ? parsed.pid : null,
  });
  onActivate();
}

export function startInstanceActivationService(
  userDataDir: string,
  onActivate: () => void,
): void {
  stopInstanceActivationService(userDataDir, { removeOwnerRecord: false });

  writeOwnerRecord(userDataDir);
  // A request that predates this instance belongs to a launch that already gave
  // up waiting; serving it would raise a window nobody asked for.
  clearPendingActivationRequest(userDataDir);

  heartbeatTimer = setInterval(
    () => writeOwnerRecord(userDataDir),
    HEARTBEAT_INTERVAL_MS,
  );
  heartbeatTimer.unref?.();

  requestPollTimer = setInterval(() => {
    try {
      consumeActivationRequest(userDataDir, onActivate);
    } catch (error) {
      logger.warn('InstanceActivation', 'Activation poll failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, REQUEST_POLL_INTERVAL_MS);
  requestPollTimer.unref?.();
}

export function stopInstanceActivationService(
  userDataDir: string,
  options: { removeOwnerRecord?: boolean } = {},
): void {
  const { removeOwnerRecord = true } = options;
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  if (requestPollTimer) {
    clearInterval(requestPollTimer);
    requestPollTimer = null;
  }
  if (!removeOwnerRecord) return;
  // During the elevated relaunch the replacement instance publishes its own
  // heartbeat while this one is still shutting down; deleting the record then
  // would hide the new owner from later launches.
  const record = readJsonFile(ownerFilePath(userDataDir));
  if (record && record.pid !== process.pid) return;
  try {
    removeFileSync(ownerFilePath(userDataDir));
  } catch {
    // Best effort only.
  }
}
