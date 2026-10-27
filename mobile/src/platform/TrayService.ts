/**
 * The tray's job on Android belongs to the VpnService's own notification and
 * the quick-settings tile, which follow the native session directly.
 */
export class TrayService {
  public init(): void {}

  public dispose(): void {}

  public setDisconnected(): void {}

  public setConnecting(): void {}

  public setConnected(): void {}

  public reportError(): void {}

  public reportSwitching(): void {}

  public notify(): void {}
}

export const trayService = new TrayService();
