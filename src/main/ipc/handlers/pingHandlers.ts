import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { VlessConfig } from '../../../shared/types';
import { logger } from '../../services/LoggerService';
import { IpcDependencies } from '../dependencies';
import { assertValidServerPayload } from '../validators';

interface RegisterPingHandlersParams {
  deps: IpcDependencies;
  sendToRenderer: (channel: string, ...args: unknown[]) => void;
  stripRawConfigs: (servers: VlessConfig[]) => VlessConfig[];
}

export function registerPingHandlers({ deps, sendToRenderer, stripRawConfigs }: RegisterPingHandlersParams): void {
  const RETRY_TIMEOUT_MS = 8000;
  const RETRY_DELAY_MS = 1200;
  const buildServersFingerprint = (servers: VlessConfig[]): string =>
    servers.map((s) => `${s.uuid}|${s.address}:${s.port}`).join('||');
  const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

  /** Serialize ping-all-servers so overlapping invokes are not invalidated as "stale". */
  let pingAllQueue: Promise<unknown> = Promise.resolve();

  ipcMain.handle('ping-server', async (_event: IpcMainInvokeEvent, serverPayload: unknown) => {
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

    const results = await deps.pingService.pingServers(servers);
    const failedServers = servers.filter((server) => {
      const key = `${server.address}:${server.port}`;
      return results.get(key) == null;
    });

    if (failedServers.length > 0) {
      logger.debug('IPC', 'Retrying failed ping servers', {
        total: servers.length,
        failed: failedServers.length,
        retryTimeoutMs: RETRY_TIMEOUT_MS,
      });
      await sleep(RETRY_DELAY_MS);
      const retryResults = await deps.pingService.pingServers(failedServers, RETRY_TIMEOUT_MS);
      for (const server of failedServers) {
        const key = `${server.address}:${server.port}`;
        const retryLatency = retryResults.get(key);
        if (retryLatency != null) {
          results.set(key, retryLatency);
        }
      }
    }

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
      const key = `${server.address}:${server.port}`;
      const ping = results.get(key) ?? null;
      return { ...server, ping, pingTime };
    });

    deps.configService.setServers(updatedServers);
    sendToRenderer('update-servers', stripRawConfigs(updatedServers));

    return servers.map((server) => {
      const key = `${server.address}:${server.port}`;
      return {
        uuid: server.uuid,
        latency: results.get(key) ?? null,
      };
    });
  }

  ipcMain.handle('ping-all-servers', async (_event: IpcMainInvokeEvent, force: boolean = false) => {
    const job = pingAllQueue.then(() => runPingAllServers(force));
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
