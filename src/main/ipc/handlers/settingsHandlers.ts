import {
  BrowserWindow,
  IpcMainInvokeEvent,
  OpenDialogOptions,
  dialog,
  ipcMain,
} from 'electron';
import { normalizePerformanceSettings } from '@/shared/performanceSettings';
import { describeExecutable } from '@/main/services/runningApps';
import { logger } from '@/main/services/LoggerService';
import { IPC_INVOKE_CHANNELS, TunCapabilityStatus } from '@/shared/ipc';
import type { SnapshotReason } from '@/main/runtime/SnapshotPublisher';
import { IpcDependencies } from '@/main/ipc/dependencies';
import { assertConnectionMode } from '@/main/ipc/validators';
import { TITLE_BAR_OVERLAY, isWindowTheme } from '@/main/utils/windowChrome';

interface RegisterSettingsHandlersParams {
  deps: IpcDependencies;
  assertTrustedSender: (event: IpcMainInvokeEvent) => void;
  notifySnapshot: (reason?: SnapshotReason) => void;
}

export function registerSettingsHandlers({
  deps,
  assertTrustedSender,
  notifySnapshot,
}: RegisterSettingsHandlersParams): void {
  ipcMain.handle(
    IPC_INVOKE_CHANNELS.openExternalUrl,
    async (event: IpcMainInvokeEvent, url: unknown) => {
      assertTrustedSender(event);
      if (typeof url !== 'string' || url.length === 0) {
        throw new Error('Invalid URL');
      }
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        throw new Error('Invalid URL');
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('Only http(s) URLs are allowed');
      }
      await deps.shell.openExternal(url);
      return true;
    },
  );

  ipcMain.handle(
    IPC_INVOKE_CHANNELS.setSelectedServerId,
    (event: IpcMainInvokeEvent, serverId: unknown) => {
      assertTrustedSender(event);
      if (typeof serverId !== 'string' && serverId !== null) {
        throw new Error('Invalid selected server id');
      }
      if (
        serverId === null ||
        (typeof serverId === 'string' && serverId.trim().length === 0)
      ) {
        deps.configService.setSelectedServerId(null);
        notifySnapshot('settings');
        return true;
      }
      const exists = deps.serverRepository
        .list()
        .some((server) => server.uuid === serverId);
      if (!exists) {
        throw new Error('Selected server was not found in local configuration');
      }
      deps.configService.setSelectedServerId(serverId);
      notifySnapshot('settings');
      return true;
    },
  );

  ipcMain.handle(
    IPC_INVOKE_CHANNELS.getConnectionMode,
    (event: IpcMainInvokeEvent) => {
      assertTrustedSender(event);
      return deps.configService.getConnectionMode();
    },
  );

  ipcMain.handle(
    IPC_INVOKE_CHANNELS.setConnectionMode,
    (event: IpcMainInvokeEvent, modeValue: unknown) => {
      assertTrustedSender(event);
      const mode = assertConnectionMode(modeValue);
      if (mode === 'tun' && !deps.tunRouteService.isSupported()) {
        throw new Error(
          deps.tunRouteService.getUnsupportedReason() ||
            'TUN mode is not supported on this operating system.',
        );
      }
      const phase = deps.connectionManager.getPhase();
      if (
        phase === 'connecting' ||
        phase === 'switching' ||
        deps.connectionManager.isBusy()
      ) {
        throw new Error(
          'Wait for the connection to finish before changing connection mode.',
        );
      }
      const changed = deps.configService.getConnectionMode() !== mode;
      deps.configService.setConnectionMode(mode);
      notifySnapshot('settings');
      if (changed && phase === 'connected') {
        // The renderer follows the session phase; a failure lands in the
        // session's last error, and a UAC relaunch quits this instance.
        void deps.connectionManager.reconnect().catch((error) => {
          logger.warn(
            'IPC',
            'Reconnect after a connection mode change failed',
            {
              error: error instanceof Error ? error.message : String(error),
            },
          );
        });
      }
      return true;
    },
  );

  ipcMain.handle(
    IPC_INVOKE_CHANNELS.getTunCapabilityStatus,
    async (event: IpcMainInvokeEvent) => {
      assertTrustedSender(event);
      const supported = deps.tunRouteService.isSupported();
      const hasPrivileges = supported ? await deps.hasTunPrivileges() : false;
      const privilegeHint =
        process.platform === 'win32'
          ? 'TUN mode needs Administrator rights. Connect in TUN mode and approve the UAC prompt (or run UltimaVLESS as Administrator).'
          : process.platform === 'linux'
            ? 'TUN mode needs elevated privileges. Install a PolicyKit agent (pkexec) so UltimaVLESS can request them when you connect, or run UltimaVLESS as root.'
            : 'Run UltimaVLESS with root privileges for TUN mode.';
      const result: TunCapabilityStatus = {
        platform: process.platform,
        supported,
        hasPrivileges,
        privilegeHint: supported && !hasPrivileges ? privilegeHint : null,
        unsupportedReason: supported
          ? null
          : deps.tunRouteService.getUnsupportedReason(),
        routeMode: supported ? deps.tunRouteService.getRouteMode() : null,
        degradedReason: supported
          ? deps.tunRouteService.getDegradedReason()
          : null,
      };
      return result;
    },
  );

  ipcMain.handle(IPC_INVOKE_CHANNELS.getAppVersion, (event) => {
    assertTrustedSender(event);
    return deps.app.getVersion();
  });

  ipcMain.handle(
    IPC_INVOKE_CHANNELS.getPerformanceSettings,
    (event: IpcMainInvokeEvent) => {
      assertTrustedSender(event);
      return deps.configService.getPerformanceSettings();
    },
  );

  ipcMain.handle(
    IPC_INVOKE_CHANNELS.setPerformanceSettings,
    (event: IpcMainInvokeEvent, payload: unknown) => {
      assertTrustedSender(event);
      const settings = normalizePerformanceSettings(payload);
      deps.configService.setPerformanceSettings(settings);
      return true;
    },
  );

  // Paths stay in main: routing matches the executable name, and the renderer
  // only needs that name and the icon to show it.
  ipcMain.handle(
    IPC_INVOKE_CHANNELS.pickApplications,
    async (event: IpcMainInvokeEvent) => {
      assertTrustedSender(event);
      const options: OpenDialogOptions = {
        properties: ['openFile', 'multiSelections'],
        filters:
          process.platform === 'win32'
            ? [{ name: 'Applications', extensions: ['exe'] }]
            : [],
      };
      const owner = BrowserWindow.fromWebContents(event.sender);
      const result = owner
        ? await dialog.showOpenDialog(owner, options)
        : await dialog.showOpenDialog(options);
      if (result.canceled) return [];
      const picked = await Promise.all(
        result.filePaths.map((path) => describeExecutable(path, null)),
      );
      return picked.filter((option) => option !== null);
    },
  );

  ipcMain.handle(
    IPC_INVOKE_CHANNELS.listRunningApps,
    async (event: IpcMainInvokeEvent) => {
      assertTrustedSender(event);
      return deps.listRunningApps();
    },
  );

  ipcMain.handle(IPC_INVOKE_CHANNELS.getUiLanguage, (event) => {
    assertTrustedSender(event);
    return deps.mainLocaleService.getLanguage();
  });

  ipcMain.handle(
    IPC_INVOKE_CHANNELS.setUiLanguage,
    (event: IpcMainInvokeEvent, language: unknown) => {
      assertTrustedSender(event);
      
      if (typeof language !== 'string') {
        throw new Error('Language must be a string');
      }

      try {
        deps.mainLocaleService.setLanguage(language as any);
        return true;
      } catch (error) {
        throw new Error(`Failed to set UI language: ${String(language)}. Error: ${String(error)}`);
      }
    },
  );

  ipcMain.handle(
    IPC_INVOKE_CHANNELS.setWindowTheme,
    (event: IpcMainInvokeEvent, theme: unknown) => {
      assertTrustedSender(event);
      if (!isWindowTheme(theme)) {
        throw new Error(`Unsupported window theme: ${String(theme)}`);
      }
      // The overlay exists on Windows and Linux; macOS keeps its traffic lights.
      if (process.platform === 'darwin') return false;
      const window = BrowserWindow.fromWebContents(event.sender);
      if (!window || window.isDestroyed()) return false;
      window.setTitleBarOverlay(TITLE_BAR_OVERLAY[theme]);
      window.setBackgroundColor(theme === 'light' ? '#f3f3f0' : '#0e0f11');
      return true;
    },
  );
}
