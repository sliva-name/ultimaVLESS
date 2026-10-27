import type { BrowserWindow } from 'electron';
import { UltimaCore, type CoreEvent } from '../native/UltimaCore';
import { configureElectronShim } from '../electron';
import { flushAppStore, loadAppStore } from '../platform/appStore';
import { setNetworkInterfaces } from '../node/os';
import { installNativeFetch } from './nativeFetch';
import { mobileElectronApi, rendererContents } from './bridge';

/** Delay non-critical background work until after the first paint. */
const DEFERRED_STARTUP_WORK_MS = 1500;

/** The renderer's window as the desktop IPC layer sees it. */
const rendererWindow = {
  isDestroyed: () => false,
  webContents: rendererContents,
} as unknown as BrowserWindow;

/**
 * The Android counterpart of `src/main/main.ts`: brings the desktop
 * main-process modules up inside the WebView and installs the bridge the
 * renderer talks to.
 *
 * The desktop modules build their singletons (config, repositories, session
 * owner) when first imported, so they are imported only after the stored
 * state has been loaded.
 */
export async function bootBackend(): Promise<{
  startDeferredWork: () => void;
}> {
  const info = await UltimaCore.getAppInfo();
  configureElectronShim({ dataDir: info.dataDir, version: info.version });
  installNativeFetch();
  await loadAppStore();
  setNetworkInterfaces((await UltimaCore.getNetworkInterfaces()).interfaces);
  void UltimaCore.addListener('networkChanged', (event) => {
    setNetworkInterfaces(event.interfaces);
  });

  const [
    { registerIpcHandlers, loadInitialState },
    { connectionManager },
    { connectionMonitorService },
    { configService },
    { getServerRepository },
    { xrayService },
    { appUpdaterService },
    { logger },
  ] = await Promise.all([
    import('@/main/ipc/IpcHandler'),
    import('@/main/domain/connection/ConnectionManager'),
    import('@/main/services/ConnectionMonitorService'),
    import('@/main/services/ConfigService'),
    import('@/main/infrastructure/persistence/ElectronServerRepository'),
    import('../platform/XrayService'),
    import('../platform/AppUpdaterService'),
    import('../platform/LoggerService'),
  ]);

  logger.info('Startup', 'Android backend starting', {
    version: info.version,
    sdk: info.sdkInt,
    abi: info.abi,
    core: info.coreVersion,
  });

  registerIpcHandlers(rendererWindow);
  window.electronAPI = mobileElectronApi;

  const isSessionLive = () => connectionManager.getPhase() !== 'idle';

  /** A session the native side runs without this WebView knowing about it. */
  const adoptNativeSession = (serverId: string, mode: 'tun' | 'proxy') => {
    if (!getServerRepository().get(serverId)) {
      logger.warn('Startup', 'Native session runs an unknown server; stopping');
      void UltimaCore.stopCore();
      return;
    }
    configService.setConnectionMode(mode);
    configService.setSelectedServerId(serverId);
    void connectionManager.connect(serverId).catch((error: unknown) => {
      logger.error('Startup', 'Failed to adopt the native session', error);
    });
  };

  void UltimaCore.addListener('coreEvent', (event: CoreEvent) => {
    logger.info('Runtime', 'Native session event', event);
    if (event.type === 'started') {
      if (
        connectionManager.getPhase() === 'idle' ||
        connectionManager.getPhase() === 'failed'
      ) {
        adoptNativeSession(event.serverId, event.mode);
      }
      return;
    }
    xrayService.handleNativeStop(event);
    if (event.reason === 'user' && isSessionLive()) {
      void connectionManager.disconnect();
    } else if (event.reason === 'revoked' && isSessionLive()) {
      void connectionManager.cleanupAfterFailure(
        'VPN was turned off by another VPN app',
      );
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      void flushAppStore();
      void logger.flush();
      return;
    }
    // Like desktop resume-from-sleep: the network may have changed while
    // the app was in the background.
    connectionMonitorService.triggerImmediateHealthCheck('app-foreground');
  });

  const status = await UltimaCore.getCoreStatus();
  if (status.running && status.serverId && status.mode) {
    adoptNativeSession(status.serverId, status.mode);
  }

  return {
    startDeferredWork: () => {
      void loadInitialState(rendererWindow).catch((error: unknown) => {
        logger.error('Startup', 'Initial state load failed', error);
      });
      setTimeout(() => {
        void appUpdaterService.start().catch((error: unknown) => {
          logger.warn('Startup', 'Updater failed to start', error);
        });
      }, DEFERRED_STARTUP_WORK_MS);
    },
  };
}
