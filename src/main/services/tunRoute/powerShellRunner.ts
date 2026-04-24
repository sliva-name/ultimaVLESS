import { spawn } from 'child_process';
import { logger } from '@/main/services/LoggerService';
import { POWERSHELL_TIMEOUT } from './constants';

export interface RunPowerShellOptions {
  allowNonZeroExit?: boolean;
}

/**
 * Spawns `powershell.exe -EncodedCommand` with the provided script.
 * Extracted so the huge TunRouteService coordinator class stays focused
 * on orchestration rather than IO plumbing.
 */
export function runPowerShell(
  script: string,
  options: RunPowerShellOptions = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    const normalizedScript = `$ProgressPreference = 'SilentlyContinue'\n${script}`;
    const encodedScript = Buffer.from(normalizedScript, 'utf16le').toString(
      'base64',
    );
    const ps = spawn(
      'powershell.exe',
      [
        '-NoLogo',
        '-NonInteractive',
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-EncodedCommand',
        encodedScript,
      ],
      { windowsHide: true },
    );

    const timeout = setTimeout(() => {
      ps.kill('SIGTERM');
      reject(
        new Error(
          `PowerShell command timed out after ${POWERSHELL_TIMEOUT / 1000}s`,
        ),
      );
    }, POWERSHELL_TIMEOUT);

    let stdout = '';
    let stderr = '';
    ps.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    ps.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    ps.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    ps.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve(stdout);
        return;
      }
      if (options.allowNonZeroExit && stderr.trim().length === 0) {
        resolve(stdout);
        return;
      }
      const combined = `${stderr}\n${stdout}`.trim();
      const cleaned = cleanPowerShellError(combined);
      const fallbackMessage = `PowerShell exited with code ${code} (no stdout/stderr).`;
      const message = cleaned || fallbackMessage;
      logger.warn('TunRouteService', 'PowerShell command failed', {
        code,
        message,
        stdoutBytes: Buffer.byteLength(stdout, 'utf8'),
        stderrBytes: Buffer.byteLength(stderr, 'utf8'),
        scriptPreview: scriptPreview(script),
      });
      reject(new Error(message));
    });
  });
}

function cleanPowerShellError(message: string): string {
  const noClixmlPrefix = message.replace(/#<\s*CLIXML/g, '').trim();
  return noClixmlPrefix
    .replace(/<Objs[\s\S]*<\/Objs>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function scriptPreview(script: string): string {
  return script.replace(/\s+/g, ' ').trim().slice(0, 180);
}
