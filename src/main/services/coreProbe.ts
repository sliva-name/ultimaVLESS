import { probeHttpThroughProxy, probeTcpPort } from './networkProbe';

/** Loopback listeners of a running core (`createLocalProxyInbounds`). */
export interface CoreListenerPorts {
  socks: number;
  http: number;
}

export interface CoreTrafficProbeOptions {
  timeoutMs: number;
  attempts: number;
  gapMs: number;
  signal?: AbortSignal;
}

/**
 * The app's own checks of the core it runs: whether it takes connections and
 * whether a request through it gets an answer. Here both go through the
 * core's local SOCKS and HTTP listeners. Android replaces this module: its
 * VPN sessions have no such listeners (`mobile/src/platform/coreProbe.ts`).
 */
export async function probeCoreListeners(
  ports: CoreListenerPorts,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<boolean> {
  const [socksReady, httpReady] = await Promise.all([
    probeTcpPort(ports.socks, '127.0.0.1', timeoutMs, signal),
    probeTcpPort(ports.http, '127.0.0.1', timeoutMs, signal),
  ]);
  return socksReady && httpReady;
}

export function probeTrafficThroughCore(
  ports: CoreListenerPorts,
  options: CoreTrafficProbeOptions,
): Promise<boolean> {
  return probeHttpThroughProxy(
    ports.http,
    '127.0.0.1',
    options.timeoutMs,
    options.attempts,
    options.gapMs,
    options.signal,
  );
}
