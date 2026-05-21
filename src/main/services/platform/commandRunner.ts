import { spawn } from 'child_process';

export interface CommandOutput {
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface RunProcessOptions {
  timeoutMs: number;
  windowsHide?: boolean;
}

export function runProcessWithOutput(
  command: string,
  args: string[],
  options: RunProcessOptions,
): Promise<CommandOutput> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: options.windowsHide });
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
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
