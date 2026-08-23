import { IpcMainInvokeEvent, ipcMain } from 'electron';
import {
  AddSubscriptionResult,
  IPC_INVOKE_CHANNELS,
  SaveManualLinksResult,
} from '@/shared/ipc';
import { YANDEX_TRANSLATED_MOBILE_LIST_URL } from '@/shared/subscriptionUrls';
import { logger } from '@/main/services/LoggerService';
import type { SnapshotReason } from '@/main/runtime/SnapshotPublisher';
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
  notifySnapshot: (reason?: SnapshotReason) => void;
  queueRefreshAllSubscriptions: (
    manualLinks: string,
  ) => Promise<{ configCount: number; reason?: string }>;
  restartAutoRefreshTimer: () => void;
}

export function registerSubscriptionHandlers({
  deps,
  assertTrustedSender,
  notifySnapshot,
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

      const sub = deps.subscriptionRepository.add({
        name,
        url,
        enabled: true,
      });
      notifySnapshot('subscriptions');

      const manualLinks = deps.subscriptionRepository.getManualLinks();
      const result = await queueRefreshAllSubscriptions(manualLinks);

      // Roll back when the new subscription produced no configs at all —
      // keeping a dead subscription would only spam auto-refresh with errors.
      const newSubscriptionServers = deps.serverRepository
        .list()
        .filter((s) => s.subscriptionId === sub.id);
      if (newSubscriptionServers.length === 0) {
        deps.subscriptionRepository.remove(sub.id);
        notifySnapshot('subscriptions');
        restartAutoRefreshTimer();
        return {
          ok: false,
          configCount: 0,
          error:
            result.reason ||
            'No valid configuration links were found in the subscription',
          subscriptionId: sub.id,
        } as AddSubscriptionResult & { subscriptionId: string };
      }

      restartAutoRefreshTimer();
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

      const updated = deps.subscriptionRepository.update(id, patch);
      if (!updated) {
        throw new Error(`Subscription not found: ${id}`);
      }
      notifySnapshot('subscriptions');

      if (patch.url !== undefined || patch.enabled === true) {
        const manualLinks = deps.subscriptionRepository.getManualLinks();
        await queueRefreshAllSubscriptions(manualLinks);
        restartAutoRefreshTimer();
      } else if (patch.enabled === false) {
        const existing = deps.serverRepository.list();
        const without = existing.filter((s) => s.subscriptionId !== id);
        deps.serverRepository.saveAll(without);
        notifySnapshot('subscriptions');
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
      deps.subscriptionRepository.remove(id);
      notifySnapshot('subscriptions');

      const existing = deps.serverRepository.list();
      const without = existing.filter((s) => s.subscriptionId !== id);
      deps.serverRepository.saveAll(without);
      notifySnapshot('subscriptions');

      restartAutoRefreshTimer();
      return true;
    },
  );

  ipcMain.handle(
    IPC_INVOKE_CHANNELS.refreshSubscriptions,
    async (event: IpcMainInvokeEvent) => {
      assertTrustedSender(event);
      logger.info('IPC', 'refresh-subscriptions');
      const manualLinks = deps.subscriptionRepository.getManualLinks();
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
      const existing = deps.subscriptionRepository.list();
      const alreadyExists = existing.find(
        (s) => s.url === YANDEX_TRANSLATED_MOBILE_LIST_URL,
      );
      if (!alreadyExists) {
        deps.subscriptionRepository.add({
          name: 'Mobile Whitelist',
          url: YANDEX_TRANSLATED_MOBILE_LIST_URL,
          enabled: true,
        });
        notifySnapshot('subscriptions');
      }

      const manualLinks = deps.subscriptionRepository.getManualLinks();
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

      deps.subscriptionRepository.setManualLinks(manualLinks);
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
      return deps.subscriptionRepository.getManualLinks();
    },
  );
}
