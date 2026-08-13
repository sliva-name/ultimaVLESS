import { IpcMainInvokeEvent, ipcMain } from 'electron';
import { normalizePerformanceSettings } from '@/shared/performanceSettings';
import {
  IPC_EVENT_CHANNELS,
  IPC_INVOKE_CHANNELS,
  IpcEventChannel,
  TunCapabilityStatus,
} from '@/shared/ipc';
import { IpcDependencies } from '@/main/ipc/dependencies';
import { assertConnectionMode } from '@/main/ipc/validators';

interface RegisterSettingsHandlersParams {
  deps: IpcDependencies;
  assertTrustedSender: (event: IpcMainInvokeEvent) => void;
  sendToRenderer: (channel: IpcEventChannel, ...args: unknown[]) => void;
}

export function registerSettingsHandlers({
  deps,
  assertTrustedSender,
  sendToRenderer,
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
        return true;
      }
      const exists = deps.serverRepository
        .list()
        .some((server) => server.uuid === serverId);
      if (!exists) {
        throw new Error('Selected server was not found in local configuration');
      }
      deps.configService.setSelectedServerId(serverId);
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
      if (deps.xrayService.isRunning()) {
        throw new Error('Disconnect before changing connection mode.');
      }
      deps.configService.setConnectionMode(mode);
      // Push an updated snapshot so the renderer stays in sync with the mode.
      sendToRenderer(IPC_EVENT_CHANNELS.appSnapshotChanged);
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

  ipcMain.handle(IPC_INVOKE_CHANNELS.getUiLanguage, (event) => {
    assertTrustedSender(event);
    return deps.mainLocaleService.getLanguage();
  });

  ipcMain.handle(
    IPC_INVOKE_CHANNELS.setUiLanguage,
    (event: IpcMainInvokeEvent, language: unknown) => {
      assertTrustedSender(event);
      if (language !== 'en' && language !== 'ru') {
        throw new Error(`Unsupported UI language: ${String(language)}`);
      }
      deps.mainLocaleService.setLanguage(language);
      return true;
    },
  );
}
