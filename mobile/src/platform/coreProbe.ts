import {
  probeCoreListeners as probeProxyListeners,
  probeTrafficThroughCore as probeTrafficThroughProxy,
  type CoreListenerPorts,
  type CoreTrafficProbeOptions,
} from '@desktop/main/services/coreProbe';
import { CONNECTIVITY_TARGETS } from '@/main/services/networkProbe';
import { UltimaCore } from '../native/UltimaCore';

export type { CoreListenerPorts, CoreTrafficProbeOptions };

/**
 * The desktop checks reach the core through its loopback listeners, which a
 * VPN session does not have: any app could use them, the ones the VPN leaves
 * out too (`adaptConfigForAndroid`). Such a session takes connections while
 * the native core runs it, and its traffic check is a request made inside
 * the core. Proxy-only sessions keep the desktop checks.
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

export async function probeTrafficThroughCore(
  ports: CoreListenerPorts,
  options: CoreTrafficProbeOptions,
): Promise<boolean> {
  const status = await UltimaCore.getCoreStatus();
  if (!status.running) return false;
  if (status.mode !== 'tun') {
    return probeTrafficThroughProxy(ports, options);
  }
  for (let attempt = 0; attempt < options.attempts; attempt++) {
    if (options.signal?.aborted) return false;
    if (await reachAnyTargetInsideCore(options.timeoutMs, options.signal)) {
      return true;
    }
    if (attempt < options.attempts - 1) {
      await new Promise((r) => setTimeout(r, options.gapMs));
    }
  }
  return false;
}

/** As on desktop, the first connectivity target to answer settles it. */
function reachAnyTargetInsideCore(
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<boolean> {
  if (signal?.aborted) return Promise.resolve(false);
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
    // The native call has its own 12 s limit; an answer after this is ignored.
    const timer = setTimeout(() => finish(false), timeoutMs);
    signal?.addEventListener('abort', onAbort, { once: true });
    for (const target of CONNECTIVITY_TARGETS) {
      UltimaCore.measureCoreDelay({
        url: `http://${target.host}${target.path}`,
      }).then(
        () => finish(true),
        () => {
          pending -= 1;
          if (pending === 0) finish(false);
        },
      );
    }
  });
}
