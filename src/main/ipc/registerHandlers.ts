import type { IpcMainInvokeEvent } from 'electron';
import type { IpcEventChannel } from '@/shared/ipc';
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
  sendToRenderer: (channel: IpcEventChannel, ...args: unknown[]) => void;
  queueRefreshAllSubscriptions: (
    manualLinks: string,
  ) => Promise<{ configCount: number; reason?: string }>;
  restartAutoRefreshTimer: () => void;
}

export function registerHandlers({
  deps,
  assertTrustedSender,
  sendToRenderer,
  queueRefreshAllSubscriptions,
  restartAutoRefreshTimer,
}: RegisterHandlersParams): void {
  registerSubscriptionHandlers({
    deps,
    assertTrustedSender,
    sendToRenderer,
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
    sendToRenderer,
  });

  registerAppSnapshotHandler({
    deps,
    assertTrustedSender,
  });

  registerPingHandlers({
    deps,
    sendToRenderer,
    assertTrustedSender,
    isConnectionBusy: () => deps.connectionController.isBusy(),
  });

  registerDiagnosticsHandlers({
    deps,
    assertTrustedSender,
  });

  registerUpdateHandlers({
    deps,
    assertTrustedSender,
  });
}
