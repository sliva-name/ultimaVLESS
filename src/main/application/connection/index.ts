import type { VlessConfig } from '@/shared/types';
import type { ConnectionManager } from '@/main/domain/connection/ConnectionManager';

export interface ConnectionApplication {
  connect(serverId: string): Promise<void>;
  disconnect(options?: { preservePendingTunReconnect?: boolean }): Promise<void>;
  switchServer(server: VlessConfig): Promise<void>;
  handleRuntimeFailure(
    reason: string,
    options?: { localProxyReachable?: boolean | null },
  ): Promise<void>;
}

export function createConnectionApplication(
  manager: ConnectionManager,
): ConnectionApplication {
  return {
    connect: (serverId) => manager.connect(serverId),
    disconnect: (options) => manager.disconnect(options),
    switchServer: (server) => manager.switchToServer(server),
    handleRuntimeFailure: (reason, options) =>
      manager.handleRuntimeFailure(reason, options),
  };
}
