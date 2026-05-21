export interface PlatformTunAdapter {
  isSupported(): boolean;
  getUnsupportedReason(): string | null;
  getRouteMode(): string | null;
  getDegradedReason(): string | null;
}

export function createPlatformTunAdapter(
  platform: NodeJS.Platform,
): PlatformTunAdapter {
  return {
    isSupported: () => platform === 'win32' || platform === 'linux',
    getUnsupportedReason: () => {
      if (platform === 'win32' || platform === 'linux') return null;
      if (platform === 'darwin') {
        return 'TUN mode is currently supported only on Windows and Linux by the bundled Xray core.';
      }
      return 'TUN mode is not supported on this operating system.';
    },
    getRouteMode: () => {
      if (platform === 'win32') return 'windows-static-routes';
      if (platform === 'linux') return 'linux-xray-auto-route';
      return null;
    },
    getDegradedReason: () => {
      if (platform === 'linux') {
        return 'Linux TUN routing currently relies on Xray auto-route behavior rather than explicit OS-level route teardown.';
      }
      return null;
    },
  };
}
