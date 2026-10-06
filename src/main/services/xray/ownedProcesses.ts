import type { ChildProcess } from 'child_process';

/**
 * PIDs of every Xray this process spawned (connection slots, real-delay
 * probes) that has not exited yet. Our cores share the `xray.exe` image name
 * with the ones other clients ship; this is how the conflict scan tells them
 * apart without asking PowerShell for executable paths.
 */
const liveXrayPids = new Set<number>();

export function trackOwnedXrayProcess(child: ChildProcess): void {
  const pid = child.pid;
  // No PID: the spawn itself failed, so there is no process to own.
  if (pid == null) return;
  liveXrayPids.add(pid);
  child.once('exit', () => {
    liveXrayPids.delete(pid);
  });
}

export function getOwnedXrayPids(): number[] {
  return [...liveXrayPids];
}
