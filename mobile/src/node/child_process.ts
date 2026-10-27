/** Android apps cannot spawn the desktop helpers (xray, PowerShell, pkexec). */

function unavailable(): never {
  throw new Error('Child processes are not available on Android');
}

export const spawn = unavailable;
export const execFile = unavailable;
export const exec = unavailable;
export const spawnSync = unavailable;
export const execFileSync = unavailable;

export default { spawn, execFile, exec, spawnSync, execFileSync };
