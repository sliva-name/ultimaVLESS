import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { XrayHealthStatus } from '@/shared/ipc';
import type { VlessConfig } from '@/shared/types';
import type { HttpRequestOptions } from '../src/native/UltimaCore';
import type { FakeCore } from './fakeCore';

const fake = vi.hoisted(() => ({ core: null as FakeCore | null }));

vi.mock('../src/native/UltimaCore', async () => {
  const { FakeCore: Fake } = await import('./fakeCore');
  fake.core = new Fake();
  return { UltimaCore: fake.core.plugin };
});

const { probeCoreListeners, probeTrafficThroughCore } =
  await import('../src/platform/coreProbe');
const { CONNECTIVITY_TARGETS } = await import('@/main/services/networkProbe');
const { createRuntimeValidator } =
  await import('@/main/domain/connection/RuntimeValidator');
const { runConnectionHealthProbe } =
  await import('@/main/services/connectionMonitor/healthProbe');

const PORTS = { socks: 10808, http: 10809 };
const OPTIONS = { timeoutMs: 1000, attempts: 2, gapMs: 0 };

const RUNNING: XrayHealthStatus = {
  state: 'running',
  ready: true,
  xrayRunning: true,
  lastStartAt: 1,
  lastReadyAt: 1,
  lastReadinessCheckAt: 1,
  localProxyReachable: null,
  lastFailureAt: null,
  lastFailureReason: null,
  lastReadinessError: null,
};

describe('Android core probes', () => {
  let core: FakeCore;
  let proxied: HttpRequestOptions[];

  const runSession = (mode: 'tun' | 'proxy' | null) => {
    core.status = {
      running: mode !== null,
      mode,
      serverId: mode ? 'server' : null,
      sessionName: mode ? 'NL' : null,
      startedAt: mode ? Date.now() : null,
    };
  };

  beforeEach(() => {
    core = fake.core!;
    core.tcpHosts = [];
    core.coreRequests = [];
    core.coreRequestsWork = true;
    proxied = [];
    core.httpHandler = (options) => {
      if (options.proxyPort !== undefined) proxied.push(options);
      return { status: 204, headers: {}, body: '', truncated: false };
    };
    vi.restoreAllMocks();
  });

  it('checks a VPN session inside the core, with no loopback proxy', async () => {
    runSession('tun');
    expect(await probeCoreListeners(PORTS, 500)).toBe(true);
    expect(await probeTrafficThroughCore(PORTS, OPTIONS)).toBe(true);
    expect(core.tcpHosts).toEqual([]);
    expect(proxied).toEqual([]);
    expect(core.coreRequests).toEqual(
      CONNECTIVITY_TARGETS.map((t) => `http://${t.host}${t.path}`),
    );
  });

  it('fails a VPN session whose core reaches none of the targets', async () => {
    runSession('tun');
    core.coreRequestsWork = false;
    expect(await probeTrafficThroughCore(PORTS, OPTIONS)).toBe(false);
    expect(core.coreRequests).toHaveLength(
      OPTIONS.attempts * CONNECTIVITY_TARGETS.length,
    );
  });

  it('gives up on a core that does not answer within the timeout', async () => {
    runSession('tun');
    vi.spyOn(core.plugin, 'measureCoreDelay').mockImplementation(
      () => new Promise(() => undefined),
    );
    const started = Date.now();
    expect(
      await probeTrafficThroughCore(PORTS, {
        timeoutMs: 50,
        attempts: 1,
        gapMs: 0,
      }),
    ).toBe(false);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('stops at once when the check is aborted', async () => {
    runSession('tun');
    const controller = new AbortController();
    controller.abort();
    expect(
      await probeTrafficThroughCore(PORTS, {
        ...OPTIONS,
        signal: controller.signal,
      }),
    ).toBe(false);
    expect(core.coreRequests).toEqual([]);
  });

  it('keeps the desktop loopback checks for a proxy-only session', async () => {
    runSession('proxy');
    expect(await probeCoreListeners(PORTS, 500)).toBe(true);
    expect(core.tcpHosts).toEqual(['127.0.0.1', '127.0.0.1']);
    expect(await probeTrafficThroughCore(PORTS, OPTIONS)).toBe(true);
    expect(proxied.length).toBeGreaterThan(0);
    expect(proxied.every((o) => o.proxyPort === PORTS.http)).toBe(true);
    expect(core.coreRequests).toEqual([]);
  });

  it('is what the desktop validator and health monitor run', async () => {
    runSession('tun');
    const validator = createRuntimeValidator({
      getXrayHealthStatus: () => RUNNING,
      timeoutMs: 1000,
    });
    const spec = {
      server: { uuid: 'server', name: 'NL' } as VlessConfig,
      mode: 'tun' as const,
      ports: { ...PORTS, api: 10813 },
    };
    expect(await validator.validate(spec)).toBe(true);
    const health = await runConnectionHealthProbe({
      getXrayHealthStatus: () => RUNNING,
      connectionMode: 'tun',
      ports: PORTS,
      tunnelProbe: { timeoutMs: 1000, attempts: 1, gapMs: 0 },
    });
    expect(health.type).toBe('healthy');
    expect(core.coreRequests.length).toBeGreaterThan(0);
    expect(core.tcpHosts).toEqual([]);
    expect(proxied).toEqual([]);
  });

  it('reports no session as down without probing anything', async () => {
    runSession(null);
    expect(await probeCoreListeners(PORTS, 500)).toBe(false);
    expect(await probeTrafficThroughCore(PORTS, OPTIONS)).toBe(false);
    expect(core.tcpHosts).toEqual([]);
    expect(proxied).toEqual([]);
  });
});
