import { ipcMain, IpcMainInvokeEvent } from 'electron';
import {
  allServersHaveFreshPing,
  filterServersNeedingPing,
} from '@/shared/pingFilters';
import { PerfTimer } from '@/shared/perfMetrics';
import { IPC_INVOKE_CHANNELS } from '@/shared/ipc';
import type { SnapshotReason } from '@/main/runtime/SnapshotPublisher';
import { logger } from '@/main/services/LoggerService';
import { IpcDependencies } from '@/main/ipc/dependencies';
import { assertBoolean, assertValidServerPayload } from '@/main/ipc/validators';
import { createSerialQueue } from '@/main/ipc/serialQueue';
import { createPingAllCoordinator } from '@/main/ipc/pingAllCoordinator';

interface RegisterPingHandlersParams {
  deps: IpcDependencies;
  notifySnapshot: (
    reason?: SnapshotReason,
    options?: { immediate?: boolean },
  ) => void;
  assertTrustedSender: (event: IpcMainInvokeEvent) => void;
  isConnectionBusy: () => boolean;
}

const INITIAL_TIMEOUT_MS = 1800;
const RETRY_TIMEOUT_MS = 3500;
const RETRY_DELAY_MS = 250;
const MIN_PING_INTERVAL_MS = 30_000;

export function registerPingHandlers({
  deps,
  notifySnapshot,
  assertTrustedSender,
  isConnectionBusy,
}: RegisterPingHandlersParams): void {
  const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms));

  const pingAllQueue = createSerialQueue();
  const isUnsafePingState = (): boolean => {
    const phase = deps.connectionManager.getPhase();
    return (
      phase === 'connected' ||
      phase === 'connecting' ||
      phase === 'switching' ||
      isConnectionBusy()
    );
  };

  const coordinator = createPingAllCoordinator({
    store: deps.serverRepository,
    notifySnapshot,
    isUnsafe: isUnsafePingState,
  });

  ipcMain.handle(
    IPC_INVOKE_CHANNELS.pingServer,
    async (_event: IpcMainInvokeEvent, serverPayload: unknown) => {
      assertTrustedSender(_event);
      try {
        const requestedServer = assertValidServerPayload(serverPayload);
        const storedServer = deps.serverRepository
          .list()
          .find((server) => server.uuid === requestedServer.uuid);
        if (!storedServer) {
          logger.error(
            'IPC',
            'ping-server failed',
            new Error('Server not found'),
          );
          return { uuid: requestedServer.uuid, latency: null };
        }

        const latency = await deps.pingService.pingServer(storedServer);
        return { uuid: storedServer.uuid, latency };
      } catch (error) {
        logger.error('IPC', 'ping-server failed', error);
        if (
          serverPayload &&
          typeof serverPayload === 'object' &&
          typeof (serverPayload as { uuid?: unknown }).uuid === 'string'
        ) {
          return {
            uuid: (serverPayload as { uuid: string }).uuid,
            latency: null,
          };
        }
        return { uuid: '', latency: null };
      }
    },
  );

  async function runPingAllServers(
    force: boolean,
  ): Promise<Array<{ uuid: string; latency: number | null }>> {
    const timer = new PerfTimer('IPC', 'ping-all-servers');
    const servers = deps.serverRepository.list();
    if (isUnsafePingState()) {
      logger.debug(
        'IPC',
        'Skipping ping-all-servers while VPN is connected or busy',
      );
      return servers.map((s) => ({ uuid: s.uuid, latency: s.ping ?? null }));
    }

    if (
      !force &&
      servers.length > 0 &&
      allServersHaveFreshPing(servers, MIN_PING_INTERVAL_MS)
    ) {
      logger.debug('IPC', 'Skipping ping - all servers have fresh latency', {
        total: servers.length,
      });
      return servers.map((s) => ({
        uuid: s.uuid,
        latency: s.ping ?? null,
      }));
    }

    const targets = filterServersNeedingPing(servers, {
      force,
      minPingIntervalMs: MIN_PING_INTERVAL_MS,
    });

    if (targets.length === 0) {
      return servers.map((s) => ({
        uuid: s.uuid,
        latency: s.ping ?? null,
      }));
    }

    const run = coordinator.beginRun(servers);

    const results = await deps.pingService.pingServers(
      targets,
      INITIAL_TIMEOUT_MS,
      {
        onResult: (uuid, latency) => {
          run.onResult(uuid, latency);
        },
      },
    );

    const failedServers = targets.filter(
      (server) => results.get(server.uuid) == null,
    );

    const currentServers = deps.serverRepository.list();
    if (isUnsafePingState() || !run.isCurrent()) {
      logger.debug(
        'IPC',
        'Dropping ping-all-servers result (network state changed)',
      );
      return currentServers.map((server) => ({
        uuid: server.uuid,
        latency: server.ping ?? null,
      }));
    }

    const updatedServers = run.persist(results, { immediate: true });

    timer.end({
      force,
      total: servers.length,
      probed: targets.length,
    });

    if (failedServers.length > 0) {
      const retryGeneration = run.generation;
      void pingAllQueue
        .enqueue(async () => {
          if (!run.isCurrent()) {
            return;
          }
          logger.debug('IPC', 'Retrying failed ping servers in background', {
            total: targets.length,
            failed: failedServers.length,
            retryTimeoutMs: RETRY_TIMEOUT_MS,
            generation: retryGeneration,
          });
          await sleep(RETRY_DELAY_MS);
          if (!run.isCurrent()) {
            return;
          }

          const retryResults = await deps.pingService.pingServers(
            failedServers,
            RETRY_TIMEOUT_MS,
          );
          if (!run.isCurrent()) {
            return;
          }
          const hasRecovered = failedServers.some(
            (server) => retryResults.get(server.uuid) != null,
          );
          if (!hasRecovered) return;

          if (isUnsafePingState()) {
            logger.debug(
              'IPC',
              'Dropping retry ping results (network state changed)',
            );
            return;
          }

          run.persist(retryResults, { immediate: true });
        })
        .catch((error) => {
          logger.error('IPC', 'Background retry ping failed', error);
        });
    }

    return updatedServers.map((server) => ({
      uuid: server.uuid,
      latency: server.ping ?? null,
    }));
  }

  ipcMain.handle(
    IPC_INVOKE_CHANNELS.pingAllServers,
    async (_event: IpcMainInvokeEvent, force: boolean = false) => {
      assertTrustedSender(_event);
      const forcePing =
        typeof force === 'undefined' ? false : assertBoolean(force, 'force');
      const job = pingAllQueue.enqueue(() => runPingAllServers(forcePing));
      try {
        return await job;
      } catch (error) {
        logger.error('IPC', 'ping-all-servers failed', error);
        return [];
      }
    },
  );
}
