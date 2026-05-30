import type { PerformanceSettings, WindowsTunRouting } from './types';

export const VALID_WINDOWS_TUN_ROUTING: readonly WindowsTunRouting[] = [
  'xray',
  'powershell',
] as const;

export function resolveWindowsTunRouting(
  perf?: Pick<PerformanceSettings, 'windowsTunRouting'> | null,
): WindowsTunRouting {
  const value = perf?.windowsTunRouting;
  return value === 'powershell' ? 'powershell' : 'xray';
}

/** Whether Xray should own the system routing table for TUN. */
export function resolveTunAutoRoute(
  platform: NodeJS.Platform,
  perf?: Pick<PerformanceSettings, 'windowsTunRouting'> | null,
): boolean {
  if (platform === 'win32') {
    return resolveWindowsTunRouting(perf) === 'xray';
  }
  return platform === 'linux' || platform === 'darwin';
}

export function usesWindowsPowerShellTunRouting(
  platform: NodeJS.Platform,
  perf?: Pick<PerformanceSettings, 'windowsTunRouting'> | null,
): boolean {
  return platform === 'win32' && resolveWindowsTunRouting(perf) === 'powershell';
}

export function getWindowsTunRouteModeLabel(
  routing: WindowsTunRouting,
): string {
  return routing === 'xray'
    ? 'windows-xray-auto-route'
    : 'windows-static-routes';
}
