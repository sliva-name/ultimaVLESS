import type { ChildProcess } from 'child_process';

/**
 * How long an exited Xray still counts as ours. A conflict scan reads the
 * process list first and our PIDs afterwards, so a core that exits in between
 * (a real-delay probe stopped as a connect starts, a core that failed to
 * start, the previous core of a reconnect) would otherwise be shown as
 * another client's Xray.
 */
const EXITED_GRACE_MS = 30_000;

/**
 * PIDs of every Xray this process spawned (connection slots, real-delay
 * probes) that is running or exited moments ago. Our cores share the
 * `xray.exe` image name with the ones other clients ship; this is how the
 * conflict scan tells them apart without asking PowerShell for executable
 * paths.
 */
const liveXrayPids = new Set<number>();
const exitedXrayPids = new Map<number, number>();

export function trackOwnedXrayProcess(
  child: ChildProcess,
  now: () => number = Date.now,
): void {
  const pid = child.pid;
  // No PID: the spawn itself failed, so there is no process to own.
  if (pid == null) return;
  liveXrayPids.add(pid);
  exitedXrayPids.delete(pid);
  child.once('exit', () => {
    liveXrayPids.delete(pid);
    exitedXrayPids.set(pid, now());
  });
}

export function getOwnedXrayPids(now: number = Date.now()): number[] {
  for (const [pid, exitedAt] of exitedXrayPids) {
    if (now - exitedAt > EXITED_GRACE_MS) exitedXrayPids.delete(pid);
  }
  return [...liveXrayPids, ...exitedXrayPids.keys()];
}
