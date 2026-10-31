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
  /**
   * Network paths this process has touched. A path counts as engaged from its
   * first `prepare()`/`activate()` until `deactivate()` succeeds.
   * Paths never engaged are never deactivated: a clean first connect must not
   * pay for tearing down state that only a previous *process* could have left
   * behind — that is the startup recovery's job.
   */
  const engaged: Record<ConnectionMode, boolean> = { proxy: false, tun: false };

  const xray = deps.xray as XrayRuntime;

  const networkFor = (mode: ConnectionMode): NetworkModeRuntime =>
    mode === 'tun' ? deps.tun : deps.proxy;

  async function deactivate(mode: ConnectionMode): Promise<void> {
    if (!engaged[mode]) return;
    await networkFor(mode).deactivate();
    engaged[mode] = false;
  }

  async function deactivateNetwork(keepProxy: boolean): Promise<void> {
    await deactivate('tun');
    if (!keepProxy) {
      await deactivate('proxy');
    }
  }

  async function tearDown(): Promise<void> {
    xray.stop();
    await deactivateNetwork(false);
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
    engaged[spec.mode] = true;
    const prepared = await network.prepare(spec);
    throwIfAborted(signal);
    try {
      await xray.start(prepared.server, spec.mode, {
        ...prepared.xrayOptions,
        ports: spec.ports,
        signal,
      });
    } catch (error) {
      // A start cancelled by `signal` fails like any other aborted step.
      throwIfAborted(signal);
      throw error;
    }
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

  /**
   * Proxy-mode switch. The next server is started and checked on the idle
   * staging ports while the current one keeps serving; only then does it take
   * over the primary ports. The system proxy, and any app pointed at
   * 127.0.0.1:10808 by hand, keeps the same ports across switches.
   */
  async function switchProxyTransaction(
    spec: ConnectionSpec,
    signal?: AbortSignal,
  ): Promise<void> {
    const stagingSpec: ConnectionSpec = {
      ...spec,
      ports: otherRuntimePorts(spec.ports),
    };
    throwIfAborted(signal);
    engaged.proxy = true;
    const prepared = await deps.proxy.prepare(stagingSpec);
    throwIfAborted(signal);
    try {
      await xray.startStaging!(prepared.server, 'proxy', {
        ...prepared.xrayOptions,
        ports: stagingSpec.ports,
      });
      throwIfAborted(signal);
      if (
        deps.validator &&
        !(await deps.validator.validate(stagingSpec, signal))
      ) {
        throw new Error('Post-switch traffic validation failed');
      }
      throwIfAborted(signal);
    } catch (error) {
      await xray.abortStaging?.();
      throw error;
    }

    // Replaces both the staging and the current process.
    try {
      await xray.start(prepared.server, 'proxy', {
        ...prepared.xrayOptions,
        ports: spec.ports,
      });
      throwIfAborted(signal);
    } catch (error) {
      await tearDown();
      throw error;
    }
    activeMode = 'proxy';
    activePorts = spec.ports;
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
        typeof xray.startStaging === 'function';

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
      xray.stop();
      await deactivateNetwork(keepProxy);
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
