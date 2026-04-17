import { app, BrowserWindow, Menu, Notification, Tray } from 'electron';
import { getAppIconPath } from '@/main/utils/runtimePaths';
import { logger } from './LoggerService';
import { mainLocaleService } from './MainLocaleService';

type TrayState =
  | { kind: 'disconnected' }
  | { kind: 'connecting' }
  | { kind: 'connected'; serverName: string; ping: number | null }
  | { kind: 'error'; message: string };

export interface TrayHandlers {
  onShow: () => void;
  onHide: () => void;
  onQuit: () => void;
  isWindowVisible: () => boolean;
}

/**
 * Centralizes tray icon management, dynamic tooltip updates, and desktop
 * notifications for connection lifecycle events. Replaces the ad-hoc
 * implementation that previously lived in main.ts.
 */
export class TrayService {
  private tray: Tray | null = null;
  private state: TrayState = { kind: 'disconnected' };
  private handlers: TrayHandlers | null = null;
  private mainWindowRef: (() => BrowserWindow | null) | null = null;

  public init(handlers: TrayHandlers, getMainWindow: () => BrowserWindow | null): void {
    if (this.tray) return;

    this.handlers = handlers;
    this.mainWindowRef = getMainWindow;
    this.tray = new Tray(getAppIconPath(process.platform));
    this.tray.on('click', () => {
      if (handlers.isWindowVisible()) {
        handlers.onHide();
      } else {
        handlers.onShow();
      }
    });
    this.tray.on('double-click', () => handlers.onShow());
    this.applyState();

    mainLocaleService.on('language-changed', () => {
      this.applyState();
    });

    logger.info('TrayService', 'Tray initialized');
  }

  public dispose(): void {
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
  }

  public setDisconnected(): void {
    const previous = this.state;
    this.state = { kind: 'disconnected' };
    this.applyState();
    if (previous.kind === 'connected') {
      this.notify(
        mainLocaleService.t('notify.disconnected.title'),
        mainLocaleService.t('notify.disconnected.body')
      );
    }
  }

  public setConnecting(): void {
    this.state = { kind: 'connecting' };
    this.applyState();
  }

  public setConnected(serverName: string, ping: number | null): void {
    const previous = this.state;
    this.state = { kind: 'connected', serverName, ping };
    this.applyState();
    if (previous.kind !== 'connected') {
      this.notify(
        mainLocaleService.t('notify.connected.title'),
        mainLocaleService.t('notify.connected.body', { name: serverName })
      );
    }
  }

  public reportError(message: string): void {
    this.state = { kind: 'error', message };
    this.applyState();
    this.notify(mainLocaleService.t('notify.error.title'), message);
  }

  public reportSwitching(): void {
    this.notify(
      mainLocaleService.t('notify.switching.title'),
      mainLocaleService.t('notify.switching.body')
    );
  }

  public notify(title: string, body: string): void {
    if (!Notification.isSupported()) return;
    try {
      const notification = new Notification({
        title,
        body,
        icon: getAppIconPath(process.platform),
        silent: false,
      });
      notification.show();
    } catch (error) {
      logger.warn('TrayService', 'Failed to show notification', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private applyState(): void {
    if (!this.tray || !this.handlers) return;

    const t = mainLocaleService.t.bind(mainLocaleService);
    this.tray.setToolTip(this.buildTooltip());

    const mainWindow = this.mainWindowRef?.();
    if (mainWindow && !mainWindow.isDestroyed()) {
      const title = this.buildWindowTitle();
      if (title !== mainWindow.getTitle()) {
        mainWindow.setTitle(title);
      }
    }

    const contextMenu = Menu.buildFromTemplate([
      { label: t('tray.show'), click: () => this.handlers?.onShow() },
      { label: t('tray.hide'), click: () => this.handlers?.onHide() },
      { type: 'separator' },
      { label: t('tray.quit'), click: () => this.handlers?.onQuit() },
    ]);
    this.tray.setContextMenu(contextMenu);
  }

  private buildTooltip(): string {
    const t = mainLocaleService.t.bind(mainLocaleService);
    const base = `UltimaVLESS ${app.getVersion()}`;
    switch (this.state.kind) {
      case 'connected': {
        const lines = [
          `${base} — ${t('tray.connected')}`,
          t('tray.connectedTo', { name: this.state.serverName }),
        ];
        if (this.state.ping != null) {
          lines.push(t('tray.ping', { ping: this.state.ping }));
        }
        return lines.join('\n');
      }
      case 'connecting':
        return `${base} — ${t('tray.connecting')}`;
      case 'error':
        return `${base} — ${this.state.message}`;
      case 'disconnected':
      default:
        return `${base} — ${t('tray.disconnected')}`;
    }
  }

  private buildWindowTitle(): string {
    const t = mainLocaleService.t.bind(mainLocaleService);
    switch (this.state.kind) {
      case 'connected':
        return `UltimaVLESS — ${t('tray.connectedTo', { name: this.state.serverName })}`;
      case 'connecting':
        return `UltimaVLESS — ${t('tray.connecting')}`;
      default:
        return 'UltimaVLESS';
    }
  }
}

export const trayService = new TrayService();
