import type { IpcMainInvokeEvent } from 'electron';
import type { SnapshotReason } from '@/main/runtime/SnapshotPublisher';
import type { IpcDependencies } from './dependencies';
import { registerAppSnapshotHandler } from './appSnapshot';
import { registerConnectionHandlers } from './handlers/connectionHandlers';
import { registerDiagnosticsHandlers } from './handlers/diagnosticsHandlers';
import { registerPingHandlers } from './handlers/pingHandlers';
import { registerSettingsHandlers } from './handlers/settingsHandlers';
import { registerSubscriptionHandlers } from './handlers/subscriptionHandlers';
import { registerUpdateHandlers } from './handlers/updateHandlers';

interface RegisterHandlersParams {
  deps: IpcDependencies;
  assertTrustedSender: (event: IpcMainInvokeEvent) => void;
  notifySnapshot: (reason?: SnapshotReason) => void;
  queueRefreshAllSubscriptions: (
    manualLinks: string,
  ) => Promise<{ configCount: number; reason?: string }>;
  restartAutoRefreshTimer: () => void;
}

export function registerHandlers({
  deps,
  assertTrustedSender,
  notifySnapshot,
  queueRefreshAllSubscriptions,
  restartAutoRefreshTimer,
}: RegisterHandlersParams): void {
  registerSubscriptionHandlers({
    deps,
    assertTrustedSender,
    notifySnapshot,
    queueRefreshAllSubscriptions,
    restartAutoRefreshTimer,
  });

  registerConnectionHandlers({
    deps,
    assertTrustedSender,
  });

  registerSettingsHandlers({
    deps,
    assertTrustedSender,
    notifySnapshot,
  });

  registerAppSnapshotHandler({
    deps,
    assertTrustedSender,
  });

  registerPingHandlers({
    deps,
    notifySnapshot,
    assertTrustedSender,
    isConnectionBusy: () => deps.connectionManager.isBusy(),
  });

  registerDiagnosticsHandlers({
    deps,
    assertTrustedSender,
    notifySnapshot,
  });

  registerUpdateHandlers({
    deps,
    assertTrustedSender,
  });
}
