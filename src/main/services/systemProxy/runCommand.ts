import {
  combineCommandOutput,
  runProcessWithOutput,
} from '@/main/services/platform/commandRunner';

/**
 * Runs a command and returns combined stdout. Rejects with combined stderr/stdout
 * on non-zero exit. Kills the process after `timeoutMs`.
 */
export async function runCommand(
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<string> {
  const output = await runProcessWithOutput(command, args, {
    timeoutMs,
    windowsHide: true,
  });
  if (output.code === 0) {
    return output.stdout;
  }
  const details =
    combineCommandOutput(output) ||
    `${command} exited with code ${output.code}`;
  throw new Error(details);
}
