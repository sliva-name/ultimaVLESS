import { logger } from '@/main/services/LoggerService';
import {
  combineCommandOutput,
  runProcessWithOutput,
} from '@/main/services/platform/commandRunner';
import { POWERSHELL_TIMEOUT } from './constants';

export interface RunPowerShellOptions {
  allowNonZeroExit?: boolean;
  timeoutMs?: number;
}

/**
 * Spawns `powershell.exe -EncodedCommand` with the provided script.
 * Extracted so the huge TunRouteService coordinator class stays focused
 * on orchestration rather than IO plumbing.
 */
export async function runPowerShell(
  script: string,
  options: RunPowerShellOptions = {},
): Promise<string> {
  const timeoutMs = options.timeoutMs ?? POWERSHELL_TIMEOUT;
  const normalizedScript = `$ProgressPreference = 'SilentlyContinue'\n${script}`;
  const encodedScript = Buffer.from(normalizedScript, 'utf16le').toString(
    'base64',
  );
  const output = await runProcessWithOutput(
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
    { timeoutMs, windowsHide: true },
  );

  if (output.code === 0) {
    return output.stdout;
  }
  if (options.allowNonZeroExit) {
    // PowerShell frequently emits warnings/progress noise on stderr even when
    // the command produced a usable result, so stderr must not gate stdout.
    const stderrText = output.stderr.trim();
    if (stderrText.length > 0) {
      logger.warn(
        'TunRouteService',
        'PowerShell exited non-zero with stderr (tolerated)',
        {
          code: output.code,
          stderr: stderrText.slice(0, 500),
          scriptPreview: scriptPreview(script),
        },
      );
    }
    return output.stdout;
  }

  const cleaned = cleanPowerShellError(combineCommandOutput(output));
  const fallbackMessage = `PowerShell exited with code ${output.code} (no stdout/stderr).`;
  const message = cleaned || fallbackMessage;
  logger.warn('TunRouteService', 'PowerShell command failed', {
    code: output.code,
    message,
    stdoutBytes: Buffer.byteLength(output.stdout, 'utf8'),
    stderrBytes: Buffer.byteLength(output.stderr, 'utf8'),
    scriptPreview: scriptPreview(script),
  });
  throw new Error(message);
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
