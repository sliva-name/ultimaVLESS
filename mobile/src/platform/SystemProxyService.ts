/**
 * Android has no system-wide proxy an app may set. Proxy mode runs Xray's
 * local SOCKS5/HTTP listeners only; apps are pointed at them by hand.
 */
export class SystemProxyService {
  public async enable(): Promise<void> {}

  public async disable(): Promise<void> {}

  public async recoverOrphanedState(): Promise<boolean> {
    return false;
  }
}

export const systemProxyService = new SystemProxyService();
