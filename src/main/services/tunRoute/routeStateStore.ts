import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { logger } from '@/main/services/LoggerService';
import { removeFileSync } from '@/main/utils/removeFile';

/**
 * What this app has put into the Windows routing table for the current TUN
 * session. Persisted next to the system-proxy snapshot so that a crashed or
 * killed session can be undone exactly on the next start — without guessing
 * from DNS lookups of the whole server catalog.
 */
export interface TunRouteState {
  version: 1;
  /** Proxy host prefixes (`203.0.113.10/32`) pinned to the physical gateway. */
  hostPrefixes: string[];
  hostRouteMetric: number;
  /** Whether we (not Xray) created the default routes via the TUN adapter. */
  defaultRoutes: boolean;
  tunInterfaceIndex: number | null;
  updatedAt: number;
}

export interface TunRouteStateStore {
  read(): TunRouteState | null;
  write(state: TunRouteState): void;
  clear(): void;
}

const STATE_FILE = 'tun-routes-state.json';

function isTunRouteState(value: unknown): value is TunRouteState {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    record.version === 1 &&
    Array.isArray(record.hostPrefixes) &&
    record.hostPrefixes.every((prefix) => typeof prefix === 'string') &&
    typeof record.hostRouteMetric === 'number' &&
    typeof record.defaultRoutes === 'boolean' &&
    (record.tunInterfaceIndex === null ||
      typeof record.tunInterfaceIndex === 'number')
  );
}

/** File-backed store under `userData`; every operation is best effort. */
export function createFileTunRouteStateStore(
  resolveDir: () => string = () => app.getPath('userData'),
): TunRouteStateStore {
  let cachedPath: string | null = null;
  const statePath = (): string => {
    cachedPath ??= path.join(resolveDir(), STATE_FILE);
    return cachedPath;
  };

  return {
    read() {
      try {
        if (!fs.existsSync(statePath())) return null;
        const parsed: unknown = JSON.parse(
          fs.readFileSync(statePath(), 'utf8'),
        );
        return isTunRouteState(parsed) ? parsed : null;
      } catch (error) {
        logger.warn('TunRouteService', 'Failed to read TUN route state', {
          error: error instanceof Error ? error.message : String(error),
        });
        return null;
      }
    },
    write(state) {
      try {
        fs.writeFileSync(statePath(), JSON.stringify(state, null, 2), 'utf8');
      } catch (error) {
        logger.warn('TunRouteService', 'Failed to persist TUN route state', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
    clear() {
      try {
        removeFileSync(statePath());
      } catch (error) {
        logger.warn('TunRouteService', 'Failed to clear TUN route state', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  };
}

/** In-memory store for tests and non-Windows platforms. */
export function createMemoryTunRouteStateStore(
  initial: TunRouteState | null = null,
): TunRouteStateStore & { current: TunRouteState | null } {
  const store = {
    current: initial,
    read: () => store.current,
    write: (state: TunRouteState) => {
      store.current = state;
    },
    clear: () => {
      store.current = null;
    },
  };
  return store;
}
