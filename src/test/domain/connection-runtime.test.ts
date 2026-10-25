import { describe, expect, it, vi } from 'vitest';
import { makeServer } from '@/test/factories';
import { createConnectionRuntime } from '@/main/domain/connection/ConnectionRuntime';
import type { ConnectionSpec } from '@/main/domain/connection/ConnectionSpec';
import type {
  NetworkModeRuntime,
  PreparedConnection,
} from '@/main/domain/connection/NetworkModeRuntime';

function fakeNetwork(mode: 'proxy' | 'tun'): NetworkModeRuntime & {
  prepare: ReturnType<typeof vi.fn>;
  activate: ReturnType<typeof vi.fn>;
  deactivate: ReturnType<typeof vi.fn>;
} {
  const prepare = vi.fn(
    async (spec: ConnectionSpec): Promise<PreparedConnection> => ({
      spec,
      server: spec.server,
    }),
  );
  const activate = vi.fn(async () => undefined);
  const deactivate = vi.fn(async () => undefined);
  return { mode, prepare, activate, deactivate };
}

function spec(
  mode: ConnectionSpec['mode'] = 'proxy',
  uuid = 'server-1',
): ConnectionSpec {
  return {
    server: makeServer({ uuid }),
    mode,
    ports: { http: 10809, socks: 10808, api: 10810 },
  };
}

describe('ConnectionRuntime', () => {
  it('rolls the data plane back if bring-up fails', async () => {
    const proxy = fakeNetwork('proxy');
    const tun = fakeNetwork('tun');
    const xrayStop = vi.fn();
    const runtime = createConnectionRuntime({
      xray: {
        start: vi.fn(async () => {
          throw new Error('spawn failed');
        }),
        stop: xrayStop,
        isRunning: () => false,
      },
      proxy,
      tun,
    });

    await expect(runtime.start(spec('proxy'))).rejects.toThrow('spawn failed');
    expect(proxy.activate).not.toHaveBeenCalled();
    // The proxy path was engaged by prepare(); TUN was never touched.
    expect(proxy.deactivate).toHaveBeenCalled();
    expect(tun.deactivate).not.toHaveBeenCalled();
    expect(xrayStop).toHaveBeenCalled();
  });

  it('stops Xray before tearing TUN routes down', async () => {
    const order: string[] = [];
    const tun = fakeNetwork('tun');
    tun.deactivate.mockImplementation(async () => {
      order.push('tun');
    });
    const stop = vi.fn(() => {
      order.push('xray');
    });
    const runtime = createConnectionRuntime({
      xray: {
        start: vi.fn(async () => undefined),
        stop,
        isRunning: () => true,
      },
      proxy: fakeNetwork('proxy'),
      tun,
    });

    await runtime.start(spec('tun'));
    order.length = 0;
    await runtime.stop();

    expect(order).toEqual(['xray', 'tun']);
  });

  it('a clean first start prepares, starts Xray and activates without tearing anything down', async () => {
    const proxy = fakeNetwork('proxy');
    const tun = fakeNetwork('tun');
    const xrayStart = vi.fn(async () => undefined);
    const xrayStop = vi.fn();
    const runtime = createConnectionRuntime({
      xray: { start: xrayStart, stop: xrayStop, isRunning: () => false },
      proxy,
      tun,
    });
    const connection = spec('proxy');

    await runtime.start(connection);

    // Nothing was engaged in this process yet, so no OS state is restored —
    // orphaned state of a previous process is the startup recovery's job.
    expect(tun.deactivate).not.toHaveBeenCalled();
    expect(proxy.deactivate).not.toHaveBeenCalled();
    expect(xrayStop).toHaveBeenCalled();
    expect(proxy.prepare).toHaveBeenCalledWith(connection);
    expect(xrayStart).toHaveBeenCalledWith(
      connection.server,
      'proxy',
      expect.objectContaining({ ports: connection.ports }),
    );
    expect(proxy.activate).toHaveBeenCalled();
    expect(tun.prepare).not.toHaveBeenCalled();
  });

  it('stop on a pristine runtime touches no network path', async () => {
    const proxy = fakeNetwork('proxy');
    const tun = fakeNetwork('tun');
    const runtime = createConnectionRuntime({
      xray: { start: vi.fn(), stop: vi.fn(), isRunning: () => false },
      proxy,
      tun,
    });

    await runtime.stop();

    expect(tun.deactivate).not.toHaveBeenCalled();
    expect(proxy.deactivate).not.toHaveBeenCalled();
  });

  it('stop restores the path that was engaged, exactly once', async () => {
    const proxy = fakeNetwork('proxy');
    const tun = fakeNetwork('tun');
    const runtime = createConnectionRuntime({
      xray: {
        start: vi.fn(async () => undefined),
        stop: vi.fn(),
        isRunning: () => false,
      },
      proxy,
      tun,
    });

    await runtime.start(spec('tun'));
    await runtime.stop();
    await runtime.stop();

    expect(tun.prepare).toHaveBeenCalledTimes(1);
    expect(tun.deactivate).toHaveBeenCalledTimes(1);
    expect(proxy.deactivate).not.toHaveBeenCalled();
  });

  it('tears TUN down even when only prepare() ran before Xray failed', async () => {
    const proxy = fakeNetwork('proxy');
    const tun = fakeNetwork('tun');
    const runtime = createConnectionRuntime({
      xray: {
        start: vi.fn(async () => {
          throw new Error('spawn failed');
        }),
        stop: vi.fn(),
        isRunning: () => false,
      },
      proxy,
      tun,
    });

    await expect(runtime.start(spec('tun'))).rejects.toThrow('spawn failed');

    // prepare() pins host routes on Windows before Xray starts; they must go.
    expect(tun.activate).not.toHaveBeenCalled();
    expect(tun.deactivate).toHaveBeenCalledTimes(1);
  });

  it('keeps system proxy during a proxy-to-proxy switch and validates before commit', async () => {
    const proxy = fakeNetwork('proxy');
    const tun = fakeNetwork('tun');
    const validate = vi.fn(async () => true);
    const runtime = createConnectionRuntime({
      xray: {
        start: vi.fn(async () => undefined),
        stop: vi.fn(),
        isRunning: () => true,
      },
      proxy,
      tun,
      validator: { validate },
    });

    await runtime.start(spec('proxy', 'a'));
    proxy.deactivate.mockClear();
    tun.deactivate.mockClear();
    await runtime.switch(spec('proxy', 'b'));

    // TUN was never engaged in this process; the system proxy stays as-is.
    expect(tun.deactivate).not.toHaveBeenCalled();
    expect(proxy.deactivate).not.toHaveBeenCalled();
    expect(validate).toHaveBeenCalled();
  });

  it('does not keep system proxy when switching into TUN', async () => {
    const proxy = fakeNetwork('proxy');
    const tun = fakeNetwork('tun');
    const validate = vi.fn(async () => true);
    const runtime = createConnectionRuntime({
      xray: {
        start: vi.fn(async () => undefined),
        stop: vi.fn(),
        isRunning: () => true,
      },
      proxy,
      tun,
      validator: { validate },
    });

    await runtime.start(spec('proxy'));
    proxy.deactivate.mockClear();
    await runtime.switch(spec('tun', 'b'));

    expect(proxy.deactivate).toHaveBeenCalled();
    expect(tun.prepare).toHaveBeenCalled();
    expect(validate).toHaveBeenCalled();
  });

  it('does not commit a switch when validation fails', async () => {
    const proxy = fakeNetwork('proxy');
    const tun = fakeNetwork('tun');
    const runtime = createConnectionRuntime({
      xray: {
        start: vi.fn(async () => undefined),
        stop: vi.fn(),
        isRunning: () => true,
      },
      proxy,
      tun,
      validator: { validate: vi.fn(async () => false) },
    });

    await runtime.start(spec('proxy', 'a'));
    await expect(runtime.switch(spec('proxy', 'b'))).rejects.toThrow(
      /validation failed/,
    );
  });

  it('checks the next server on staging ports, then moves it to the primary ports', async () => {
    const proxy = fakeNetwork('proxy');
    const tun = fakeNetwork('tun');
    const start = vi.fn(async () => undefined);
    const startStaging = vi.fn(async () => undefined);
    const abortStaging = vi.fn();
    const stop = vi.fn();
    const validate = vi.fn(async () => true);
    const runtime = createConnectionRuntime({
      xray: {
        start,
        stop,
        isRunning: () => true,
        startStaging,
        abortStaging,
      },
      proxy,
      tun,
      validator: { validate },
    });

    await runtime.start(spec('proxy', 'a'));
    start.mockClear();
    proxy.activate.mockClear();
    proxy.deactivate.mockClear();
    await runtime.switch(spec('proxy', 'b'));

    expect(startStaging).toHaveBeenCalledWith(
      expect.objectContaining({ uuid: 'b' }),
      'proxy',
      expect.objectContaining({
        ports: { socks: 10818, http: 10819, api: 10820 },
      }),
    );
    expect(validate).toHaveBeenCalledWith(
      expect.objectContaining({
        ports: { socks: 10818, http: 10819, api: 10820 },
      }),
      undefined,
    );
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({ uuid: 'b' }),
      'proxy',
      expect.objectContaining({
        ports: { socks: 10808, http: 10809, api: 10810 },
      }),
    );
    expect(startStaging.mock.invocationCallOrder[0]).toBeLessThan(
      start.mock.invocationCallOrder[0],
    );
    // The system proxy already points at the primary ports.
    expect(proxy.activate).not.toHaveBeenCalled();
    expect(proxy.deactivate).not.toHaveBeenCalled();
    expect(abortStaging).not.toHaveBeenCalled();
    expect(runtime.status().ports).toEqual({
      socks: 10808,
      http: 10809,
      api: 10810,
    });
  });

  it('keeps the same ports across repeated switches', async () => {
    const proxy = fakeNetwork('proxy');
    const start = vi.fn(async () => undefined);
    const runtime = createConnectionRuntime({
      xray: {
        start,
        stop: vi.fn(),
        isRunning: () => true,
        startStaging: vi.fn(async () => undefined),
        abortStaging: vi.fn(),
      },
      proxy,
      tun: fakeNetwork('tun'),
      validator: { validate: vi.fn(async () => true) },
    });

    await runtime.start(spec('proxy', 'a'));
    for (const id of ['b', 'c', 'd']) {
      await runtime.switch(spec('proxy', id));
    }

    for (const call of start.mock.calls as unknown as Array<
      [unknown, unknown, { ports: unknown }]
    >) {
      expect(call[2].ports).toEqual({ socks: 10808, http: 10809, api: 10810 });
    }
    expect(proxy.activate).toHaveBeenCalledTimes(1);
  });

  it('aborts staging Xray and keeps the old proxy when validation fails', async () => {
    const proxy = fakeNetwork('proxy');
    const tun = fakeNetwork('tun');
    const start = vi.fn(async () => undefined);
    const startStaging = vi.fn(async () => undefined);
    const abortStaging = vi.fn();
    const stop = vi.fn();
    const runtime = createConnectionRuntime({
      xray: {
        start,
        stop,
        isRunning: () => true,
        startStaging,
        abortStaging,
      },
      proxy,
      tun,
      validator: { validate: vi.fn(async () => false) },
    });

    await runtime.start(spec('proxy', 'a'));
    start.mockClear();
    stop.mockClear();
    proxy.activate.mockClear();
    await expect(runtime.switch(spec('proxy', 'b'))).rejects.toThrow(
      /validation failed/,
    );

    expect(startStaging).toHaveBeenCalled();
    expect(abortStaging).toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
    expect(proxy.activate).not.toHaveBeenCalled();
  });

  it('tears down when the checked server cannot take over the primary ports', async () => {
    const proxy = fakeNetwork('proxy');
    const tun = fakeNetwork('tun');
    const start = vi.fn(async () => undefined);
    const stop = vi.fn();
    const runtime = createConnectionRuntime({
      xray: {
        start,
        stop,
        isRunning: () => true,
        startStaging: vi.fn(async () => undefined),
        abortStaging: vi.fn(),
      },
      proxy,
      tun,
      validator: { validate: vi.fn(async () => true) },
    });

    await runtime.start(spec('proxy', 'a'));
    start.mockRejectedValueOnce(new Error('port 10808 is in use'));
    await expect(runtime.switch(spec('proxy', 'b'))).rejects.toThrow(
      /port 10808 is in use/,
    );

    expect(stop).toHaveBeenCalled();
    expect(proxy.deactivate).toHaveBeenCalled();
    expect(runtime.status().mode).toBeNull();
  });
});
