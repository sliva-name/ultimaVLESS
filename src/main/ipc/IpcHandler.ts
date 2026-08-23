import { BrowserWindow, IpcMainEvent, IpcMainInvokeEvent } from 'electron';
import { IpcEventChannel } from '@/shared/ipc';
import { configService } from '@/main/services/ConfigService';
import { getSubscriptionRepository } from '@/main/infrastructure/persistence/ElectronSubscriptionRepository';
import { getServerRepository } from '@/main/infrastructure/persistence/ElectronServerRepository';
import { connectionController } from '@/main/services/ConnectionController';
import { subscriptionService } from '@/main/services/SubscriptionService';
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
let recovery: ReturnType<typeof createConnectionRecovery> | null = null;

function getWindow(): BrowserWindow | null {
  if (windowRef && !windowRef.isDestroyed()) return windowRef;
  return null;
}

function sendToRenderer(channel: IpcEventChannel, ...args: unknown[]): void {
  getWindow()?.webContents.send(channel, ...args);
}

function notifySnapshot(
  reason: Parameters<SnapshotPublisher['push']>[0] = 'manual',
): void {
  snapshotPublisher?.push(reason);
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
  subscriptionRepository: getSubscriptionRepository(),
  serverRepository: getServerRepository(),
  subscriptionService,
  connectionController,
  notifyStateChanged: () => snapshotPublisher?.push('subscriptions'),
});

const {
  queueRefreshAllSubscriptions,
  restartAutoRefreshTimer,
  stopAutoRefreshTimer,
  reportSubscriptionRefreshIssue,
} = subscriptionRefreshManager;

export function pushAppSnapshot(
  reason: Parameters<SnapshotPublisher['push']>[0] = 'manual',
): void {
  snapshotPublisher?.push(reason);
}

export function registerIpcHandlers(
  mainWindow: BrowserWindow,
  deps: IpcDependencies = createIpcDependencies(),
): void {
  windowRef = mainWindow;
  snapshotPublisher ??= new SnapshotPublisher({ deps, getWindow });
  recovery ??= createConnectionRecovery(deps, snapshotPublisher);
  if (handlersRegistered) {
    return;
  }
  handlersRegistered = true;

  registerRuntimeEvents({
    deps,
    snapshotPublisher,
    recovery,
    sendToRenderer,
  });
  registerHandlers({
    deps,
    assertTrustedSender,
    notifySnapshot,
    queueRefreshAllSubscriptions,
    restartAutoRefreshTimer,
  });
}

export async function loadInitialState(window: BrowserWindow): Promise<void> {
  windowRef = window;
  if (!snapshotPublisher || !recovery) {
    throw new Error(
      'loadInitialState requires registerIpcHandlers to run first',
    );
  }
  const sessionRecovery = recovery;

  await loadInitialStateRuntime(
    window,
    {
      notifySnapshot,
      queueRefreshAllSubscriptions,
      reportSubscriptionRefreshIssue,
      restartAutoRefreshTimer,
      attemptPendingTunReconnect: (serverId, _runtimeDeps, options) =>
        sessionRecovery.attemptPendingTunReconnect(serverId, options),
    },
    {
      configService,
      subscriptionRepository: getSubscriptionRepository(),
      createRuntimeDependencies: createIpcDependencies,
      stopAutoRefreshTimer,
    },
  );
}
