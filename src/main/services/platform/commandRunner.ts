import { ChildProcess, spawn } from 'child_process';
import { resolveSystemBinary } from './systemBinaries';

export interface CommandOutput {
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface RunProcessOptions {
  timeoutMs: number;
  windowsHide?: boolean;
}

/**
 * Kills a timed-out child. On Windows `child.kill('SIGTERM')` only terminates
 * the direct child and is unreliable for console hosts — grandchildren (e.g.
 * processes spawned by PowerShell) survive and can keep mutating system state
 * after the caller has already started rolling back. `taskkill /T /F` kills
 * the whole process tree; plain kill() remains as a fallback.
 */
function killProcessTree(child: ChildProcess): void {
  if (process.platform === 'win32' && child.pid != null) {
    try {
      const killer = spawn(
        resolveSystemBinary('taskkill'),
        ['/pid', String(child.pid), '/T', '/F'],
        { windowsHide: true },
      );
      killer.on('error', () => {
        child.kill('SIGTERM');
      });
      return;
    } catch {
      // fall through to the generic kill below
    }
  }
  child.kill('SIGTERM');
}

export function runProcessWithOutput(
  command: string,
  args: string[],
  options: RunProcessOptions,
): Promise<CommandOutput> {
  return new Promise((resolve, reject) => {
    const child = spawn(resolveSystemBinary(command), args, {
      windowsHide: options.windowsHide,
    });
    const timeout = setTimeout(() => {
      killProcessTree(child);
      reject(
        new Error(
          `${command} timed out after ${Math.floor(options.timeoutMs / 1000)}s`,
        ),
      );
    }, options.timeoutMs);

    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });
    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });
    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      resolve({ code, stdout, stderr });
    });
  });
}

export function combineCommandOutput(output: CommandOutput): string {
  return `${output.stderr}\n${output.stdout}`.trim();
}
