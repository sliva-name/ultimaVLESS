import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { VlessConfig } from '@/shared/types';
import {
  allServersHaveFreshPing,
  filterServersNeedingPing,
} from '@/shared/pingFilters';
import { PerfTimer } from '@/shared/perfMetrics';
import {
  IpcEventChannel,
  IPC_EVENT_CHANNELS,
  IPC_INVOKE_CHANNELS,
} from '@/shared/ipc';
import { logger } from '@/main/services/LoggerService';
import { IpcDependencies } from '@/main/ipc/dependencies';
import { assertBoolean, assertValidServerPayload } from '@/main/ipc/validators';
import { createSerialQueue } from '@/main/ipc/serialQueue';

interface RegisterPingHandlersParams {
  deps: IpcDependencies;
  sendToRenderer: (channel: IpcEventChannel, ...args: unknown[]) => void;
  assertTrustedSender: (event: IpcMainInvokeEvent) => void;
  isConnectionBusy: () => boolean;
}

const INITIAL_TIMEOUT_MS = 1800;
const RETRY_TIMEOUT_MS = 3500;
const RETRY_DELAY_MS = 250;
const PARTIAL_UPDATE_BATCH_SIZE = 8;
const MIN_PING_INTERVAL_MS = 30_000;

function buildServersFingerprint(servers: VlessConfig[]): string {
  return servers.map((s) => `${s.uuid}|${s.address}:${s.port}`).join('||');
}

function mergePingResults(
  servers: VlessConfig[],
  results: Map<string, number | null>,
  pingTime: number,
): VlessConfig[] {
  return servers.map((server) => {
    if (!results.has(server.uuid)) {
      return server;
    }
    return {
      ...server,
      ping: results.get(server.uuid) ?? null,
      pingTime,
      pingStale: false,
    };
  });
}

export function registerPingHandlers({
  deps,
  sendToRenderer,
  assertTrustedSender,
  isConnectionBusy,
}: RegisterPingHandlersParams): void {
  const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms));

  const pingAllQueue = createSerialQueue();
  const isUnsafePingState = (): boolean => {
    const monitorStatus = deps.connectionMonitorService.getStatus();
    return (
      deps.xrayService.isRunning() ||
      monitorStatus.isConnected ||
      isConnectionBusy()
    );
  };

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

    const startFingerprint = buildServersFingerprint(servers);

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

    const incrementalResults = new Map<string, number | null>();
    let resultsSinceLastPush = 0;

    const pushPartialUpdate = (): void => {
      if (incrementalResults.size === 0) {
        return;
      }
      const latest = deps.serverRepository.list();
      if (buildServersFingerprint(latest) !== startFingerprint) {
        return;
      }
      if (isUnsafePingState()) {
        return;
      }
      const pingTime = Date.now();
      const merged = mergePingResults(latest, incrementalResults, pingTime);
      deps.serverRepository.saveAll(merged);
      sendToRenderer(
        IPC_EVENT_CHANNELS.appSnapshotChanged,
      );
    };

    const results = await deps.pingService.pingServers(
      targets,
      INITIAL_TIMEOUT_MS,
      {
        onResult: (uuid, latency) => {
          incrementalResults.set(uuid, latency);
          resultsSinceLastPush += 1;
          if (resultsSinceLastPush >= PARTIAL_UPDATE_BATCH_SIZE) {
            resultsSinceLastPush = 0;
            pushPartialUpdate();
          }
        },
      },
    );

    const failedServers = targets.filter(
      (server) => results.get(server.uuid) == null,
    );

    const currentServers = deps.serverRepository.list();
    const currentFingerprint = buildServersFingerprint(currentServers);
    if (isUnsafePingState()) {
      logger.debug(
        'IPC',
        'Dropping ping-all-servers result (network state changed)',
      );
      return currentServers.map((server) => ({
        uuid: server.uuid,
        latency: server.ping ?? null,
      }));
    }

    if (currentFingerprint !== startFingerprint) {
      logger.debug(
        'IPC',
        'Dropping ping-all-servers result (server list changed)',
        {
          startCount: servers.length,
          currentCount: currentServers.length,
        },
      );
      return currentServers.map((server) => ({
        uuid: server.uuid,
        latency: server.ping ?? null,
      }));
    }

    const pingTime = Date.now();
    const updatedServers = mergePingResults(currentServers, results, pingTime);

    deps.serverRepository.saveAll(updatedServers);
    sendToRenderer(
      IPC_EVENT_CHANNELS.appSnapshotChanged,
    );

    timer.end({
      force,
      total: servers.length,
      probed: targets.length,
    });

    if (failedServers.length > 0) {
      void (async () => {
        logger.debug('IPC', 'Retrying failed ping servers in background', {
          total: targets.length,
          failed: failedServers.length,
          retryTimeoutMs: RETRY_TIMEOUT_MS,
        });
        await sleep(RETRY_DELAY_MS);

        const retryResults = await deps.pingService.pingServers(
          failedServers,
          RETRY_TIMEOUT_MS,
        );
        const hasRecovered = failedServers.some(
          (server) => retryResults.get(server.uuid) != null,
        );
        if (!hasRecovered) return;

        const latestServers = deps.serverRepository.list();
        const latestFingerprint = buildServersFingerprint(latestServers);
        if (isUnsafePingState()) {
          logger.debug(
            'IPC',
            'Dropping retry ping results (network state changed)',
          );
          return;
        }
        if (latestFingerprint !== startFingerprint) {
          logger.debug(
            'IPC',
            'Dropping retry ping results (server list changed)',
          );
          return;
        }

        const retryPingTime = Date.now();
        const mergedServers = mergePingResults(
          latestServers,
          retryResults,
          retryPingTime,
        );

        deps.serverRepository.saveAll(mergedServers);
        sendToRenderer(
          IPC_EVENT_CHANNELS.appSnapshotChanged,
        );
      })().catch((error) => {
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
