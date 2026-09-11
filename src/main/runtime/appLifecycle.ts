import { EventEmitter } from 'events';
import { app } from 'electron';

/**
 * Why the process is going away. Shutdown steps differ per reason: a relaunch
 * for elevation hands its window, its instance-owner record and its log files
 * over to the replacement process, while a user quit tears everything down.
 */
export type QuitReason = 'user' | 'elevated-relaunch' | 'update';

interface AppLifecycleEvents {
  'quit-requested': [reason: QuitReason];
}

/**
 * Single entry point for "please quit the app". Domain code (session owner)
 * and UI glue (tray) call {@link requestQuit}; `main.ts` listens and adapts the
 * shutdown to the reason instead of guessing from persisted state.
 */
export class AppLifecycle extends EventEmitter<AppLifecycleEvents> {
  private reason: QuitReason | null = null;

  constructor(private readonly quitApp: () => void = () => app.quit()) {
    super();
  }

  /** Reason of the first quit request, or `null` while the app keeps running. */
  public get quitReason(): QuitReason | null {
    return this.reason;
  }

  public get isRelaunchingElevated(): boolean {
    return this.reason === 'elevated-relaunch';
  }

  /**
   * Records the reason (first one wins), lets listeners prepare, then asks
   * Electron to quit. Repeated calls are ignored so a tray click during an
   * in-flight relaunch cannot downgrade the reason.
   */
  public requestQuit(reason: QuitReason): void {
    if (this.reason !== null) {
      return;
    }
    this.reason = reason;
    this.emit('quit-requested', reason);
    this.quitApp();
  }

  /**
   * Marks a quit that Electron is already driving (OS session end, or
   * electron-updater's own `quitAndInstall`), so later code sees a reason.
   */
  public noteExternalQuit(reason: QuitReason): void {
    this.reason ??= reason;
  }
}

export const appLifecycle = new AppLifecycle();
