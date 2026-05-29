import { BrowserWindow, IpcMainEvent, IpcMainInvokeEvent } from 'electron';
import { IPC_EVENT_CHANNELS, IpcEventChannel } from '@/shared/ipc';
import { configService } from '@/main/services/ConfigService';
import { connectionMonitorService } from '@/main/services/ConnectionMonitorService';
import { subscriptionService } from '@/main/services/SubscriptionService';
import { xrayService } from '@/main/services/XrayService';
import { SnapshotPublisher } from '@/main/runtime/SnapshotPublisher';
import { createConnectionRecovery } from '@/main/runtime/ConnectionRecovery';
import { registerRuntimeEvents } from '@/main/runtime/registerRuntimeEvents';
import { createIpcDependencies, IpcDependencies } from './dependencies';
import { loadInitialState as loadInitialStateRuntime } from './initialState';
import { createSubscriptionRefreshManager } from './subscriptionRefresh';
import { registerHandlers } from './registerHandlers';

let windowRef: BrowserWindow | null = null;
let handlersRegistered = false;
let snapshotPublisher: SnapshotPublisher | null = null;

function getWindow(): BrowserWindow | null {
  if (windowRef && !windowRef.isDestroyed()) return windowRef;
  return null;
}

function sendToRenderer(channel: IpcEventChannel, ...args: unknown[]): void {
  if (channel === IPC_EVENT_CHANNELS.appSnapshotChanged && args.length === 0) {
    snapshotPublisher?.push('manual');
    return;
  }
  getWindow()?.webContents.send(channel, ...args);
}

function assertTrustedSender(event: IpcMainEvent | IpcMainInvokeEvent): void {
  const win = getWindow();
  if (!win || event.sender.id !== win.webContents.id) {
    throw new Error('Blocked IPC request from untrusted sender');
  }
}

const subscriptionRefreshManager = createSubscriptionRefreshManager({
  getWindow,
  configService,
  subscriptionService,
  connectionMonitorService,
  xrayService,
  notifyStateChanged: () => snapshotPublisher?.push('subscriptions'),
});

const {
  queueRefreshAllSubscriptions,
  restartAutoRefreshTimer,
  stopAutoRefreshTimer,
  reportSubscriptionRefreshIssue,
} = subscriptionRefreshManager;

export function registerIpcHandlers(
  mainWindow: BrowserWindow,
  deps: IpcDependencies = createIpcDependencies(),
): void {
  windowRef = mainWindow;
  snapshotPublisher = new SnapshotPublisher({ deps, getWindow });
  if (handlersRegistered) {
    return;
  }
  handlersRegistered = true;

  const recovery = createConnectionRecovery(deps, snapshotPublisher);
  registerRuntimeEvents({
    deps,
    snapshotPublisher,
    recovery,
    sendToRenderer,
  });
  registerHandlers({
    deps,
    assertTrustedSender,
    sendToRenderer,
    queueRefreshAllSubscriptions,
    restartAutoRefreshTimer,
  });
}

export async function loadInitialState(window: BrowserWindow): Promise<void> {
  windowRef = window;
  const deps = createIpcDependencies();
  const publisher =
    snapshotPublisher ?? new SnapshotPublisher({ deps, getWindow });

  await loadInitialStateRuntime(
    window,
    {
      sendToRenderer,
      queueRefreshAllSubscriptions,
      reportSubscriptionRefreshIssue,
      restartAutoRefreshTimer,
      attemptPendingTunReconnect: (serverId, runtimeDeps, options) =>
        createConnectionRecovery(
          runtimeDeps,
          publisher,
        ).attemptPendingTunReconnect(serverId, options),
    },
    {
      configService,
      connectionMonitorService,
      xrayService,
      createRuntimeDependencies: createIpcDependencies,
      stopAutoRefreshTimer,
    },
  );
}
