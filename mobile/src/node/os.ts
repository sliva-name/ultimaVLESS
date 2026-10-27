import type { NetworkInterfaceInfo } from '../native/UltimaCore';

/**
 * `os.networkInterfaces()` must answer synchronously, so it reads a snapshot
 * the backend keeps current from the plugin's `networkChanged` events. The
 * native side leaves the VPN's own TUN interface out.
 */
let interfaces: Record<string, NetworkInterfaceInfo[]> = {};

export function setNetworkInterfaces(
  next: Record<string, NetworkInterfaceInfo[]>,
): void {
  interfaces = next;
}

export function networkInterfaces(): Record<string, NetworkInterfaceInfo[]> {
  return interfaces;
}

export function platform(): string {
  return 'android';
}

export function tmpdir(): string {
  return '/tmp';
}

export function homedir(): string {
  return '/';
}

export const EOL = '\n';

export default { networkInterfaces, platform, tmpdir, homedir, EOL };
