import { spawn } from 'child_process';

/**
 * Runs a command and returns combined stdout. Rejects with combined stderr/stdout
 * on non-zero exit. Kills the process after `timeoutMs`.
 */
export function runCommand(command: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`${command} timed out after ${Math.floor(timeoutMs / 1000)}s`));
    }, timeoutMs);

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve(stdout);
        return;
      }
      const details = `${stderr}\n${stdout}`.trim() || `${command} exited with code ${code}`;
      reject(new Error(details));
    });
  });
}
