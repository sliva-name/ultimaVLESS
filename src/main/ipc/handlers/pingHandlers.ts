import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { VlessConfig } from '../../../shared/types';
import { IpcEventChannel, IPC_EVENT_CHANNELS, IPC_INVOKE_CHANNELS } from '../../../shared/ipc';
import { logger } from '../../services/LoggerService';
import { IpcDependencies } from '../dependencies';
import { assertBoolean, assertValidServerPayload } from '../validators';

interface RegisterPingHandlersParams {
  deps: IpcDependencies;
  sendToRenderer: (channel: IpcEventChannel, ...args: unknown[]) => void;
  stripRawConfigs: (servers: VlessConfig[]) => VlessConfig[];
  assertTrustedSender: (event: IpcMainInvokeEvent) => void;
}

export function registerPingHandlers({ deps, sendToRenderer, stripRawConfigs, assertTrustedSender }: RegisterPingHandlersParams): void {
  const INITIAL_TIMEOUT_MS = 1800;
  const RETRY_TIMEOUT_MS = 3500;
  const RETRY_DELAY_MS = 250;
  const buildServersFingerprint = (servers: VlessConfig[]): string =>
    servers.map((s) => `${s.uuid}|${s.address}:${s.port}`).join('||');
  const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

  /** Serialize ping-all-servers so overlapping invokes are not invalidated as "stale". */
  let pingAllQueue: Promise<unknown> = Promise.resolve();

  ipcMain.handle(IPC_INVOKE_CHANNELS.pingServer, async (_event: IpcMainInvokeEvent, serverPayload: unknown) => {
    assertTrustedSender(_event);
    try {
      const requestedServer = assertValidServerPayload(serverPayload);
      const storedServer = deps.configService.getServers().find((server) => server.uuid === requestedServer.uuid);
      if (!storedServer) {
        throw new Error('Server not found');
      }

      const latency = await deps.pingService.pingServer(storedServer);
      return { uuid: storedServer.uuid, latency };
    } catch (error) {
      logger.error('IPC', 'ping-server failed', error);
      if (serverPayload && typeof serverPayload === 'object' && typeof (serverPayload as { uuid?: unknown }).uuid === 'string') {
        return { uuid: (serverPayload as { uuid: string }).uuid, latency: null };
      }
      return { uuid: '', latency: null };
    }
  });

  async function runPingAllServers(force: boolean): Promise<Array<{ uuid: string; latency: number | null }>> {
    const servers = deps.configService.getServers();
    const startFingerprint = buildServersFingerprint(servers);

    if (!force && servers.length > 0) {
      const now = Date.now();
      const minPingInterval = 30000;
      const serversWithPing = servers.filter((s) => s.pingTime && s.pingTime > 0);

      if (serversWithPing.length < servers.length) {
        logger.debug('IPC', 'Pinging - not all servers have ping data', {
          total: servers.length,
          withPing: serversWithPing.length,
        });
      } else {
        const oldestPingTime = Math.min(...servers.map((s) => s.pingTime || 0).filter((t) => t > 0));
        const timeSinceLastPing = now - oldestPingTime;
        if (oldestPingTime > 0 && timeSinceLastPing < minPingInterval) {
          logger.debug('IPC', 'Skipping ping - too soon since last ping', { timeSinceLastPing });
          return servers.map((s) => ({ uuid: s.uuid, latency: s.ping ?? null }));
        }
      }
    }

    const results = await deps.pingService.pingServers(servers, INITIAL_TIMEOUT_MS);
    const failedServers = servers.filter((server) => {
      const key = server.uuid;
      return results.get(key) == null;
    });

    const currentServers = deps.configService.getServers();
    const currentFingerprint = buildServersFingerprint(currentServers);

    // Drop results only if the server list changed while this ping was in flight.
    if (currentFingerprint !== startFingerprint) {
      logger.debug('IPC', 'Dropping ping-all-servers result (server list changed)', {
        startCount: servers.length,
        currentCount: currentServers.length,
      });
      return currentServers.map((server) => ({
        uuid: server.uuid,
        latency: server.ping ?? null,
      }));
    }

    const pingTime = Date.now();
    const updatedServers = servers.map((server) => {
      const key = server.uuid;
      const ping = results.get(key) ?? null;
      return { ...server, ping, pingTime };
    });

    deps.configService.setServers(updatedServers);
    sendToRenderer(IPC_EVENT_CHANNELS.updateServers, stripRawConfigs(updatedServers));

    if (failedServers.length > 0) {
      void (async () => {
        logger.debug('IPC', 'Retrying failed ping servers in background', {
          total: servers.length,
          failed: failedServers.length,
          retryTimeoutMs: RETRY_TIMEOUT_MS,
        });
        await sleep(RETRY_DELAY_MS);

        const retryResults = await deps.pingService.pingServers(failedServers, RETRY_TIMEOUT_MS);
        const hasRecovered = failedServers.some((server) => retryResults.get(server.uuid) != null);
        if (!hasRecovered) return;

        const latestServers = deps.configService.getServers();
        const latestFingerprint = buildServersFingerprint(latestServers);
        if (latestFingerprint !== startFingerprint) {
          logger.debug('IPC', 'Dropping retry ping results (server list changed)');
          return;
        }

        const retryPingTime = Date.now();
        const mergedServers = latestServers.map((server) => {
          const retryLatency = retryResults.get(server.uuid);
          if (retryLatency == null) {
            return server;
          }
          return {
            ...server,
            ping: retryLatency,
            pingTime: retryPingTime,
          };
        });

        deps.configService.setServers(mergedServers);
        sendToRenderer(IPC_EVENT_CHANNELS.updateServers, stripRawConfigs(mergedServers));
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

  ipcMain.handle(IPC_INVOKE_CHANNELS.pingAllServers, async (_event: IpcMainInvokeEvent, force: boolean = false) => {
    assertTrustedSender(_event);
    const forcePing = typeof force === 'undefined' ? false : assertBoolean(force, 'force');
    const job = pingAllQueue.then(() => runPingAllServers(forcePing));
    pingAllQueue = job.then(
      () => undefined,
      () => undefined
    );
    try {
      return await job;
    } catch (error) {
      logger.error('IPC', 'ping-all-servers failed', error);
      return [];
    }
  });
}
