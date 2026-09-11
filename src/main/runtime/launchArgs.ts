import { RELAUNCH_ARG } from '@/shared/constants';

/**
 * True when this process was started by a previous UltimaVLESS instance that
 * needed Administrator rights (see `relaunchAsAdminOnWindows`). Such a launch
 * must keep booting instead of handing activation back to the instance it is
 * replacing, and it is expected to find a pending TUN reconnect to resume.
 */
export function isElevatedRelaunch(
  argv: readonly string[] = process.argv,
): boolean {
  return argv.includes(RELAUNCH_ARG);
}
