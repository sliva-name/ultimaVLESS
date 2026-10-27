/**
 * The VPN consent dialog is Android's privilege prompt, and the native layer
 * shows it when a TUN session starts. There is nothing to elevate or relaunch.
 */
export async function hasTunPrivileges(): Promise<boolean> {
  return true;
}

export async function requestTunPrivilegesRelaunch(): Promise<boolean> {
  return false;
}

export async function isElevatedOnWindows(): Promise<boolean> {
  return false;
}

export async function relaunchAsAdminOnWindows(): Promise<boolean> {
  return false;
}
