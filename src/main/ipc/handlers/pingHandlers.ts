import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { VlessConfig } from '@/shared/types';
import {
  IpcEventChannel,
  IPC_EVENT_CHANNELS,
  IPC_INVOKE_CHANNELS,
  ServerPingPatch,
} from '@/shared/ipc';
import { logger } from '@/main/services/LoggerService';
import { IpcDependencies } from '@/main/ipc/dependencies';
import { assertBoolean, assertValidServerPayload } from '@/main/ipc/validators';
import { createSerialQueue } from '@/main/utils/serialQueue';

interface RegisterPingHandlersParams {
  deps: IpcDependencies;
  sendToRenderer: (channel: IpcEventChannel, ...args: unknown[]) => void;
  assertTrustedSender: (event: IpcMainInvokeEvent) => void;
  isConnectionBusy: () => boolean;
}

export function registerPingHandlers({
  deps,
  sendToRenderer,
  assertTrustedSender,
  isConnectionBusy,
}: RegisterPingHandlersParams): void {
  const INITIAL_TIMEOUT_MS = 1800;
  const RETRY_TIMEOUT_MS = 3500;
  const RETRY_DELAY_MS = 250;
  const buildServersFingerprint = (servers: VlessConfig[]): string =>
    servers.map((s) => `${s.uuid}|${s.address}:${s.port}`).join('||');
  const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms));
  const buildPingPatches = (
    servers: VlessConfig[],
    results: Map<string, number | null>,
    pingTime: number,
    options: { includeFailures: boolean },
  ): ServerPingPatch[] =>
    servers.flatMap((server) => {
      if (!results.has(server.uuid)) {
        return [];
      }
      const ping = results.get(server.uuid) ?? null;
      if (!options.includeFailures && ping == null) {
        return [];
      }
      return [
        {
          uuid: server.uuid,
          ping,
          pingTime,
          pingStale: false,
        },
      ];
    });
  const applyPingPatches = (
    patches: ServerPingPatch[],
    options: { debouncePersist: boolean },
  ): VlessConfig[] => {
    if (patches.length === 0) {
      return deps.configService.getServers();
    }
    const updatedServers = deps.configService.setServerPingPatches(patches, {
      debounce: options.debouncePersist,
    });
    sendToRenderer(IPC_EVENT_CHANNELS.updateServerPings, patches);
    return updatedServers;
  };

  /** Serialize ping-all-servers so overlapping invokes are not invalidated as "stale". */
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
        const storedServer = deps.configService
          .getServers()
          .find((server) => server.uuid === requestedServer.uuid);
        if (!storedServer) {
          throw new Error('Server not found');
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
    const servers = deps.configService.getServers();
    if (isUnsafePingState()) {
      logger.debug(
        'IPC',
        'Skipping ping-all-servers while VPN is connected or busy',
      );
      return servers.map((s) => ({ uuid: s.uuid, latency: s.ping ?? null }));
    }
    const startFingerprint = buildServersFingerprint(servers);

    if (!force && servers.length > 0) {
      const now = Date.now();
      const minPingInterval = 30000;
      const serversWithPing = servers.filter(
        (s) => s.pingTime && s.pingTime > 0,
      );

      if (serversWithPing.length < servers.length) {
        logger.debug('IPC', 'Pinging - not all servers have ping data', {
          total: servers.length,
          withPing: serversWithPing.length,
        });
      } else {
        const oldestPingTime = Math.min(
          ...servers.map((s) => s.pingTime || 0).filter((t) => t > 0),
        );
        const timeSinceLastPing = now - oldestPingTime;
        if (oldestPingTime > 0 && timeSinceLastPing < minPingInterval) {
          logger.debug('IPC', 'Skipping ping - too soon since last ping', {
            timeSinceLastPing,
          });
          return servers.map((s) => ({
            uuid: s.uuid,
            latency: s.ping ?? null,
          }));
        }
      }
    }

    const results = await deps.pingService.pingServers(
      servers,
      INITIAL_TIMEOUT_MS,
    );
    const failedServers = servers.filter((server) => {
      const key = server.uuid;
      return results.get(key) == null;
    });

    const currentServers = deps.configService.getServers();
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

    // Drop results only if the server list changed while this ping was in flight.
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

    const pingPatches = buildPingPatches(servers, results, Date.now(), {
      includeFailures: true,
    });
    applyPingPatches(pingPatches, { debouncePersist: true });

    if (failedServers.length > 0) {
      void (async () => {
        logger.debug('IPC', 'Retrying failed ping servers in background', {
          total: servers.length,
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

        const latestServers = deps.configService.getServers();
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

        const retryPatches = buildPingPatches(
          failedServers,
          retryResults,
          Date.now(),
          {
            includeFailures: false,
          },
        );
        if (retryPatches.length === 0) {
          return;
        }

        applyPingPatches(retryPatches, {
          debouncePersist: true,
        });
      })().catch((error) => {
        logger.error('IPC', 'Background retry ping failed', error);
      });
    }

    return servers.map((server) => {
      const key = server.uuid;
      return {
        uuid: server.uuid,
        latency: results.get(key) ?? null,
      };
    });
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
