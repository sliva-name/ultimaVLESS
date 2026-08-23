import type { ConnectionMode } from '@/shared/types';
import type {
  XrayService,
  XrayStartOptions,
} from '@/main/services/XrayService';
import {
  otherRuntimePorts,
  PRIMARY_RUNTIME_PORTS,
  type RuntimePorts,
} from '@/shared/constants';
import { logger } from '@/main/services/LoggerService';
import { throwIfAborted } from './abort';
import type { ConnectionSpec } from './ConnectionSpec';
import type { NetworkModeRuntime } from './NetworkModeRuntime';
import type { RuntimeValidator } from './RuntimeValidator';

export interface RuntimeStatus {
  xrayRunning: boolean;
  mode: ConnectionMode | null;
  ports: RuntimePorts;
}

export interface XrayRuntime {
  start(
    server: ConnectionSpec['server'],
    mode: ConnectionMode,
    options?: XrayStartOptions,
  ): Promise<void>;
  stop(): void;
  isRunning(): boolean;
  startStaging?(
    server: ConnectionSpec['server'],
    mode: ConnectionMode,
    options?: XrayStartOptions,
  ): Promise<void>;
  commitStaging?(): void | Promise<void>;
  abortStaging?(): void | Promise<void>;
  getActivePorts?(): RuntimePorts;
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
  xray: XrayRuntime | Pick<XrayService, 'start' | 'stop' | 'isRunning'>;
  proxy: NetworkModeRuntime;
  tun: NetworkModeRuntime;
  validator?: RuntimeValidator;
}): ConnectionRuntime {
  let activeMode: ConnectionMode | null = null;
  let activePorts: RuntimePorts = { ...PRIMARY_RUNTIME_PORTS };

  const xray = deps.xray as XrayRuntime;

  const networkFor = (mode: ConnectionMode): NetworkModeRuntime =>
    mode === 'tun' ? deps.tun : deps.proxy;

  async function deactivateNetwork(keepProxy: boolean): Promise<void> {
    await deps.tun.deactivate();
    if (!keepProxy) {
      await deps.proxy.deactivate();
    }
  }

  async function tearDown(): Promise<void> {
    await deactivateNetwork(false);
    xray.stop();
    activeMode = null;
    activePorts = { ...PRIMARY_RUNTIME_PORTS };
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
    await xray.start(prepared.server, spec.mode, {
      ...prepared.xrayOptions,
      ports: spec.ports,
    });
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
    activePorts = spec.ports;
  }

  async function switchProxyTransaction(
    spec: ConnectionSpec,
    signal?: AbortSignal,
  ): Promise<void> {
    const previousPorts = activePorts;
    const nextPorts = otherRuntimePorts(activePorts);
    const nextSpec: ConnectionSpec = { ...spec, ports: nextPorts };
    throwIfAborted(signal);
    const prepared = await deps.proxy.prepare(nextSpec);
    throwIfAborted(signal);
    let proxyRetargetAttempted = false;
    let committed = false;
    try {
      await xray.startStaging!(prepared.server, 'proxy', {
        ...prepared.xrayOptions,
        ports: nextPorts,
      });
      throwIfAborted(signal);
      if (
        deps.validator &&
        !(await deps.validator.validate(nextSpec, signal))
      ) {
        throw new Error('Post-switch traffic validation failed');
      }
      throwIfAborted(signal);
      proxyRetargetAttempted = true;
      await deps.proxy.activate(prepared);
      throwIfAborted(signal);
      await xray.commitStaging!();
      committed = true;
      activeMode = 'proxy';
      activePorts = nextPorts;
    } catch (error) {
      if (!committed && proxyRetargetAttempted) {
        try {
          await deps.proxy.activate({
            spec: { ...spec, mode: 'proxy', ports: previousPorts },
            server: spec.server,
          });
        } catch (restoreError) {
          logger.warn(
            'ConnectionRuntime',
            'Failed to restore system proxy after aborted switch',
            {
              error:
                restoreError instanceof Error
                  ? restoreError.message
                  : String(restoreError),
            },
          );
        }
      }
      if (!committed) {
        await xray.abortStaging?.();
      }
      throw error;
    }
  }

  return {
    async start(spec: ConnectionSpec, signal?: AbortSignal): Promise<void> {
      await tearDown();
      try {
        await bringUp(spec, signal, { validate: false });
      } catch (error) {
        await tearDown();
        throw error;
      }
    },

    async stop(): Promise<void> {
      await tearDown();
    },

    async switch(spec: ConnectionSpec, signal?: AbortSignal): Promise<void> {
      const canStage =
        spec.mode === 'proxy' &&
        activeMode === 'proxy' &&
        typeof xray.startStaging === 'function' &&
        typeof xray.commitStaging === 'function';

      if (canStage) {
        try {
          await switchProxyTransaction(spec, signal);
          return;
        } catch (error) {
          logger.warn(
            'ConnectionRuntime',
            'Transactional proxy switch failed',
            {
              serverId: spec.server.uuid.substring(0, 8),
              error: error instanceof Error ? error.message : String(error),
            },
          );
          throw error;
        }
      }

      const keepProxy = activeMode === 'proxy' && spec.mode === 'proxy';
      await deactivateNetwork(keepProxy);
      xray.stop();
      try {
        await bringUp(spec, signal, { validate: true });
      } catch (error) {
        await tearDown();
        logger.warn(
          'ConnectionRuntime',
          'Switch did not commit; runtime torn down',
          {
            mode: spec.mode,
            serverId: spec.server.uuid.substring(0, 8),
            error: error instanceof Error ? error.message : String(error),
          },
        );
        throw error;
      }
    },

    status(): RuntimeStatus {
      return {
        xrayRunning: xray.isRunning(),
        mode: activeMode,
        ports: xray.getActivePorts?.() ?? activePorts,
      };
    },
  };
}
