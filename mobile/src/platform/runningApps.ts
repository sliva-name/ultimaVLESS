import type { AppOption } from '@/shared/appRouting';
import { UltimaCore } from '../native/UltimaCore';

/**
 * Per-app routing on Android names packages (`org.telegram.messenger`), so
 * the picker lists installed apps instead of running executables.
 */
export async function listRunningApps(): Promise<AppOption[]> {
  const { apps } = await UltimaCore.listApps();
  return apps.map((installed) => ({
    name: installed.packageName,
    description: installed.label,
    icon: installed.icon,
    system: installed.system,
  }));
}

/** No file picker for executables on Android. */
export async function describeExecutable(): Promise<AppOption | null> {
  return null;
}
