import {
  probeCoreListeners as probeProxyListeners,
  type CoreListenerPorts,
  type CoreProbeRoute,
  type CoreTrafficProbeOptions,
} from '@desktop/main/services/coreProbe';
import { CONNECTIVITY_TARGETS } from '@/main/services/networkProbe';
import { app } from '../electron';
import { UltimaCore } from '../native/UltimaCore';

export type { CoreListenerPorts, CoreProbeRoute, CoreTrafficProbeOptions };

/** The inbound the app's own probes enter the core through. */
export const CORE_PROBE_INBOUND_TAG = 'core-probe';

/**
 * A Unix socket in the app's private files. No other app can open it, so
 * unlike a loopback port it is no way into the server, and the rule may pin
 * whatever comes through it to the tunnel. `CoreRuntime.PROBE_SOCKET` names
 * the same file: Xray does not replace one a killed core left behind, so the
 * native side removes it before each start.
 */
export function coreProbeSocketPath(): string {
  return `${app.getPath('userData')}/core-probe.sock`;
}

export function coreProbeRoute(): CoreProbeRoute {
  return {
    inbounds: [
      {
        tag: CORE_PROBE_INBOUND_TAG,
        listen: coreProbeSocketPath(),
        port: 0,
        protocol: 'http',
        settings: {},
      },
    ],
    rule: {
      type: 'field',
      inboundTag: [CORE_PROBE_INBOUND_TAG],
      outboundTag: 'proxy',
    },
  };
}

/**
 * A VPN session's core has no loopback listener: any app could use one, the
 * ones the VPN leaves out too (`adaptConfigForAndroid`). It takes
 * connections while the native core runs it. A proxy-only session's local
 * proxy is what the user's apps connect to, so it is probed as on desktop.
 */
export async function probeCoreListeners(
  ports: CoreListenerPorts,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<boolean> {
  const status = await UltimaCore.getCoreStatus();
  if (!status.running) return false;
  if (status.mode !== 'tun') {
    return probeProxyListeners(ports, timeoutMs, signal);
  }
  return true;
}

/** In either mode the request goes in through the probe socket. */
export async function probeTrafficThroughCore(
  _ports: CoreListenerPorts,
  options: CoreTrafficProbeOptions,
): Promise<boolean> {
  const status = await UltimaCore.getCoreStatus();
  if (!status.running) return false;
  for (let attempt = 0; attempt < options.attempts; attempt++) {
    if (options.signal?.aborted) return false;
    if (await reachAnyTargetThroughCore(options.timeoutMs, options.signal)) {
      return true;
    }
    if (attempt < options.attempts - 1) {
      await new Promise((r) => setTimeout(r, options.gapMs));
    }
  }
  return false;
}

/** As on desktop, the first connectivity target to answer settles it. */
function reachAnyTargetThroughCore(
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<boolean> {
  if (signal?.aborted) return Promise.resolve(false);
  const path = coreProbeSocketPath();
  return new Promise((resolve) => {
    let pending = CONNECTIVITY_TARGETS.length;
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve(ok);
    };
    const onAbort = () => finish(false);
    const failed = () => {
      pending -= 1;
      if (pending === 0) finish(false);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    signal?.addEventListener('abort', onAbort, { once: true });
    for (const target of CONNECTIVITY_TARGETS) {
      UltimaCore.probeCoreSocket({
        path,
        url: `http://${target.host}${target.path}`,
        timeoutMs,
      }).then(
        ({ status }) =>
          status >= 200 && status < 400 ? finish(true) : failed(),
        failed,
      );
    }
  });
}
