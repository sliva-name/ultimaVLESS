import { IpcMainInvokeEvent, ipcMain } from 'electron';
import {
  AddSubscriptionResult,
  IPC_EVENT_CHANNELS,
  IPC_INVOKE_CHANNELS,
  IpcEventChannel,
  SaveManualLinksResult,
} from '@/shared/ipc';
import { YANDEX_TRANSLATED_MOBILE_LIST_URL } from '@/shared/subscriptionUrls';
import { logger } from '@/main/services/LoggerService';
import { IpcDependencies } from '@/main/ipc/dependencies';
import {
  normalizeAddSubscriptionPayload,
  normalizeManualLinks,
  normalizeUpdateSubscriptionPayload,
  redactUrl,
} from '@/main/ipc/validators';

interface RegisterSubscriptionHandlersParams {
  deps: IpcDependencies;
  assertTrustedSender: (event: IpcMainInvokeEvent) => void;
  sendToRenderer: (channel: IpcEventChannel, ...args: unknown[]) => void;
  queueRefreshAllSubscriptions: (
    manualLinks: string,
  ) => Promise<{ configCount: number; reason?: string }>;
  restartAutoRefreshTimer: () => void;
}

export function registerSubscriptionHandlers({
  deps,
  assertTrustedSender,
  sendToRenderer,
  queueRefreshAllSubscriptions,
  restartAutoRefreshTimer,
}: RegisterSubscriptionHandlersParams): void {
  ipcMain.handle(
    IPC_INVOKE_CHANNELS.addSubscription,
    async (event: IpcMainInvokeEvent, payload: unknown) => {
      assertTrustedSender(event);
      const { name, url } = normalizeAddSubscriptionPayload(payload);
      logger.info('IPC', 'add-subscription', {
        name,
        redactedUrl: redactUrl(url),
      });

      const sub = deps.configService.addSubscription({
        name,
        url,
        enabled: true,
      });
      sendToRenderer(
        IPC_EVENT_CHANNELS.appSnapshotChanged,
      );

      const manualLinks = deps.configService.getManualLinksInput();
      const result = await queueRefreshAllSubscriptions(manualLinks);
      restartAutoRefreshTimer();

      if (result.configCount === 0) {
        return {
          ok: false,
          configCount: 0,
          error:
            result.reason ||
            'No valid configuration links were found in the subscription',
          subscriptionId: sub.id,
        } as AddSubscriptionResult & { subscriptionId: string };
      }
      return {
        ok: true,
        configCount: result.configCount,
        subscriptionId: sub.id,
      } as AddSubscriptionResult & { subscriptionId: string };
    },
  );

  ipcMain.handle(
    IPC_INVOKE_CHANNELS.updateSubscription,
    async (event: IpcMainInvokeEvent, payload: unknown) => {
      assertTrustedSender(event);
      const { id, patch } = normalizeUpdateSubscriptionPayload(payload);
      logger.info('IPC', 'update-subscription', { id });

      const updated = deps.configService.updateSubscription(id, patch);
      if (!updated) {
        throw new Error(`Subscription not found: ${id}`);
      }
      sendToRenderer(
        IPC_EVENT_CHANNELS.appSnapshotChanged,
      );

      if (patch.url !== undefined || patch.enabled === true) {
        const manualLinks = deps.configService.getManualLinksInput();
        await queueRefreshAllSubscriptions(manualLinks);
        restartAutoRefreshTimer();
      } else if (patch.enabled === false) {
        const existing = deps.configService.getServers();
        const without = existing.filter((s) => s.subscriptionId !== id);
        deps.configService.setServers(without);
        sendToRenderer(
          IPC_EVENT_CHANNELS.appSnapshotChanged,
        );
        restartAutoRefreshTimer();
      }

      return true;
    },
  );

  ipcMain.handle(
    IPC_INVOKE_CHANNELS.deleteSubscription,
    async (event: IpcMainInvokeEvent, payload: unknown) => {
      assertTrustedSender(event);
      if (!payload || typeof payload !== 'object') {
        throw new Error('Invalid payload');
      }
      const id = (payload as Record<string, unknown>).id;
      if (typeof id !== 'string' || !id.trim()) {
        throw new Error('Subscription id is required');
      }

      logger.info('IPC', 'delete-subscription', { id });
      deps.configService.removeSubscription(id);
      sendToRenderer(
        IPC_EVENT_CHANNELS.appSnapshotChanged,
      );

      const existing = deps.configService.getServers();
      const without = existing.filter((s) => s.subscriptionId !== id);
      deps.configService.setServers(without);
      sendToRenderer(
        IPC_EVENT_CHANNELS.appSnapshotChanged,
      );

      restartAutoRefreshTimer();
      return true;
    },
  );

  ipcMain.handle(
    IPC_INVOKE_CHANNELS.refreshSubscriptions,
    async (event: IpcMainInvokeEvent) => {
      assertTrustedSender(event);
      logger.info('IPC', 'refresh-subscriptions');
      const manualLinks = deps.configService.getManualLinksInput();
      const result = await queueRefreshAllSubscriptions(manualLinks);
      return {
        ok: result.configCount > 0,
        configCount: result.configCount,
        error: result.reason,
      };
    },
  );

  ipcMain.handle(
    IPC_INVOKE_CHANNELS.importMobileWhiteListSubscription,
    async (event: IpcMainInvokeEvent) => {
      assertTrustedSender(event);
      const existing = deps.configService.getSubscriptions();
      const alreadyExists = existing.find(
        (s) => s.url === YANDEX_TRANSLATED_MOBILE_LIST_URL,
      );
      if (!alreadyExists) {
        deps.configService.addSubscription({
          name: 'Mobile Whitelist',
          url: YANDEX_TRANSLATED_MOBILE_LIST_URL,
          enabled: true,
        });
        sendToRenderer(
          IPC_EVENT_CHANNELS.appSnapshotChanged,
        );
      }

      const manualLinks = deps.configService.getManualLinksInput();
      const result = await queueRefreshAllSubscriptions(manualLinks);
      restartAutoRefreshTimer();

      if (result.configCount === 0) {
        return {
          ok: false,
          configCount: 0,
          error: result.reason || 'No valid configuration links were found',
        };
      }
      return { ok: true, configCount: result.configCount };
    },
  );

  ipcMain.handle(
    IPC_INVOKE_CHANNELS.saveManualLinks,
    async (event: IpcMainInvokeEvent, payload: unknown) => {
      assertTrustedSender(event);
      const manualLinks = normalizeManualLinks(payload);
      logger.info('IPC', 'save-manual-links', {
        hasManualLinks: !!manualLinks.trim(),
      });

      deps.configService.setManualLinksInput(manualLinks);
      const result = await queueRefreshAllSubscriptions(manualLinks);
      restartAutoRefreshTimer();

      if (result.configCount === 0 && !!manualLinks.trim()) {
        return {
          ok: false,
          configCount: 0,
          error: result.reason || 'No valid configs found in manual links',
        } as SaveManualLinksResult;
      }
      return {
        ok: true,
        configCount: result.configCount,
      } as SaveManualLinksResult;
    },
  );

  ipcMain.handle(
    IPC_INVOKE_CHANNELS.getManualLinks,
    (event: IpcMainInvokeEvent) => {
      assertTrustedSender(event);
      return deps.configService.getManualLinksInput();
    },
  );
}
