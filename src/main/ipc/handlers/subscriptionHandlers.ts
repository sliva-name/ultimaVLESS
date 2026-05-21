import { IpcMainInvokeEvent, ipcMain } from 'electron';
import {
  AddSubscriptionResult,
  IPC_EVENT_CHANNELS,
  IPC_INVOKE_CHANNELS,
  IpcEventChannel,
  SaveManualLinksResult,
} from '@/shared/ipc';
import { YANDEX_TRANSLATED_MOBILE_LIST_URL } from '@/shared/subscriptionUrls';
import { toSafeServerList } from '@/shared/serverView';
import { configService } from '@/main/services/ConfigService';
import { logger } from '@/main/services/LoggerService';
import {
  normalizeAddSubscriptionPayload,
  normalizeManualLinks,
  normalizeUpdateSubscriptionPayload,
  redactUrl,
} from '@/main/ipc/validators';

interface RegisterSubscriptionHandlersParams {
  assertTrustedSender: (event: IpcMainInvokeEvent) => void;
  sendToRenderer: (channel: IpcEventChannel, ...args: unknown[]) => void;
  queueRefreshAllSubscriptions: (
    manualLinks: string,
  ) => Promise<{ configCount: number; reason?: string }>;
  restartAutoRefreshTimer: () => void;
}

export function registerSubscriptionHandlers({
  assertTrustedSender,
  sendToRenderer,
  queueRefreshAllSubscriptions,
  restartAutoRefreshTimer,
}: RegisterSubscriptionHandlersParams): void {
  ipcMain.handle(
    IPC_INVOKE_CHANNELS.getSubscriptions,
    (event: IpcMainInvokeEvent) => {
      assertTrustedSender(event);
      return configService.getSubscriptions();
    },
  );

  ipcMain.handle(
    IPC_INVOKE_CHANNELS.addSubscription,
    async (event: IpcMainInvokeEvent, payload: unknown) => {
      assertTrustedSender(event);
      const { name, url } = normalizeAddSubscriptionPayload(payload);
      logger.info('IPC', 'add-subscription', {
        name,
        redactedUrl: redactUrl(url),
      });

      const sub = configService.addSubscription({ name, url, enabled: true });
      sendToRenderer(
        IPC_EVENT_CHANNELS.updateSubscriptions,
        configService.getSubscriptions(),
      );

      const manualLinks = configService.getManualLinksInput();
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

      const updated = configService.updateSubscription(id, patch);
      if (!updated) {
        throw new Error(`Subscription not found: ${id}`);
      }
      sendToRenderer(
        IPC_EVENT_CHANNELS.updateSubscriptions,
        configService.getSubscriptions(),
      );

      if (patch.url !== undefined || patch.enabled === true) {
        const manualLinks = configService.getManualLinksInput();
        await queueRefreshAllSubscriptions(manualLinks);
        restartAutoRefreshTimer();
      } else if (patch.enabled === false) {
        const existing = configService.getServers();
        const without = existing.filter((s) => s.subscriptionId !== id);
        configService.setServers(without);
        sendToRenderer(
          IPC_EVENT_CHANNELS.updateServers,
          toSafeServerList(without),
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
      configService.removeSubscription(id);
      sendToRenderer(
        IPC_EVENT_CHANNELS.updateSubscriptions,
        configService.getSubscriptions(),
      );

      const existing = configService.getServers();
      const without = existing.filter((s) => s.subscriptionId !== id);
      configService.setServers(without);
      sendToRenderer(IPC_EVENT_CHANNELS.updateServers, toSafeServerList(without));

      restartAutoRefreshTimer();
      return true;
    },
  );

  ipcMain.handle(
    IPC_INVOKE_CHANNELS.refreshSubscriptions,
    async (event: IpcMainInvokeEvent) => {
      assertTrustedSender(event);
      logger.info('IPC', 'refresh-subscriptions');
      const manualLinks = configService.getManualLinksInput();
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
      const existing = configService.getSubscriptions();
      const alreadyExists = existing.find(
        (s) => s.url === YANDEX_TRANSLATED_MOBILE_LIST_URL,
      );
      if (!alreadyExists) {
        configService.addSubscription({
          name: 'Mobile Whitelist',
          url: YANDEX_TRANSLATED_MOBILE_LIST_URL,
          enabled: true,
        });
        sendToRenderer(
          IPC_EVENT_CHANNELS.updateSubscriptions,
          configService.getSubscriptions(),
        );
      }

      const manualLinks = configService.getManualLinksInput();
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

      configService.setManualLinksInput(manualLinks);
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
      return configService.getManualLinksInput();
    },
  );
}
