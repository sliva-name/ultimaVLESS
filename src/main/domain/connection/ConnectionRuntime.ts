import type { ConnectionMode } from '@/shared/types';
import type { XrayService } from '@/main/services/XrayService';
import { logger } from '@/main/services/LoggerService';
import { throwIfAborted } from './abort';
import type { ConnectionSpec } from './ConnectionSpec';
import type { NetworkModeRuntime } from './NetworkModeRuntime';
import type { RuntimeValidator } from './RuntimeValidator';

export interface RuntimeStatus {
  xrayRunning: boolean;
  mode: ConnectionMode | null;
}

/**
 * Data-plane owner for Xray + network path lifecycle.
 * Control plane must only call start / switch / stop.
 */
export interface ConnectionRuntime {
  start(spec: ConnectionSpec, signal?: AbortSignal): Promise<void>;
  stop(signal?: AbortSignal): Promise<void>;
  switch(spec: ConnectionSpec, signal?: AbortSignal): Promise<void>;
  status(): RuntimeStatus;
}

export function createConnectionRuntime(deps: {
  xray: Pick<XrayService, 'start' | 'stop' | 'isRunning'>;
  proxy: NetworkModeRuntime;
  tun: NetworkModeRuntime;
  validator?: RuntimeValidator;
}): ConnectionRuntime {
  let activeMode: ConnectionMode | null = null;

  const networkFor = (mode: ConnectionMode): NetworkModeRuntime =>
    mode === 'tun' ? deps.tun : deps.proxy;

  async function deactivateNetwork(keepProxy: boolean): Promise<void> {
    await deps.tun.deactivate();
    if (!keepProxy) {
      await deps.proxy.deactivate();
    }
  }

  async function bringUp(
    spec: ConnectionSpec,
    signal?: AbortSignal,
    options: { validate: boolean } = { validate: false },
  ): Promise<void> {
    throwIfAborted(signal);
    const network = networkFor(spec.mode);
    const prepared = await network.prepare(spec);
    throwIfAborted(signal);
    await deps.xray.start(prepared.server, spec.mode, prepared.xrayOptions);
    throwIfAborted(signal);
    await network.activate(prepared);
    throwIfAborted(signal);
    if (options.validate && deps.validator) {
      const ok = await deps.validator.validate(spec, signal);
      if (!ok) {
        throw new Error('Post-switch traffic validation failed');
      }
    }
    activeMode = spec.mode;
  }

  return {
    async start(spec: ConnectionSpec, signal?: AbortSignal): Promise<void> {
      await deactivateNetwork(false);
      deps.xray.stop();
      await bringUp(spec, signal, { validate: false });
    },

    async stop(): Promise<void> {
      await deactivateNetwork(false);
      deps.xray.stop();
      activeMode = null;
    },

    async switch(spec: ConnectionSpec, signal?: AbortSignal): Promise<void> {
      // Proxy-mode switch keeps the OS proxy aimed at loopback so apps fail
      // closed while the next Xray instance comes up. TUN always rebuilds
      // routes. Validation is required before the switch is committed.
      const keepProxy = activeMode === 'proxy' && spec.mode === 'proxy';
      await deactivateNetwork(keepProxy);
      deps.xray.stop();
      try {
        await bringUp(spec, signal, { validate: true });
      } catch (error) {
        logger.warn('ConnectionRuntime', 'Switch did not validate; runtime not committed', {
          mode: spec.mode,
          serverId: spec.server.uuid.substring(0, 8),
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },

    status(): RuntimeStatus {
      return {
        xrayRunning: deps.xray.isRunning(),
        mode: activeMode,
      };
    },
  };
}
