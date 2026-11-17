import { randomUUID } from 'crypto';
import type { XrayInbound, XrayRoutingRule } from '@/shared/xray-types';
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

/** What the config needs so that the probes reach the server in every mode. */
export interface CoreProbeRoute {
  /** Inbounds the probes enter through, beside the local proxy. */
  inbounds: XrayInbound[];
  /** Sends the probes, and nothing else, to the `proxy` outbound. */
  rule: XrayRoutingRule;
}

const PROBE_HEADER = 'X-Ultima-Probe';
/**
 * Marks this run's probe requests. Only the probes may be pinned to the
 * tunnel: a rule on their destinations would take any program's request to
 * those hosts there too, a spoofed `Host` included, and show it the server's
 * address.
 */
const PROBE_SECRET = randomUUID();

/**
 * The app's own checks of the core it runs: whether it takes connections and
 * whether a request through it gets an answer. Here both go through the
 * core's local SOCKS and HTTP listeners, the request marked with this run's
 * secret. Android replaces this module: its probes enter through a socket in
 * the app's private files (`mobile/src/platform/coreProbe.ts`).
 */
export function coreProbeRoute(): CoreProbeRoute {
  return {
    inbounds: [],
    rule: {
      type: 'field',
      inboundTag: ['http'],
      attrs: { [PROBE_HEADER.toLowerCase()]: PROBE_SECRET },
      outboundTag: 'proxy',
    },
  };
}

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
    { [PROBE_HEADER]: PROBE_SECRET },
  );
}
