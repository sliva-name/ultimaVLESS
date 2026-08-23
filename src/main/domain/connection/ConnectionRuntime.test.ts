import { describe, expect, it, vi } from 'vitest';
import { makeServer } from '@/test/factories';
import { createConnectionRuntime } from './ConnectionRuntime';
import type { ConnectionSpec } from './ConnectionSpec';
import type {
  NetworkModeRuntime,
  PreparedConnection,
} from './NetworkModeRuntime';

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
    expect(proxy.deactivate).toHaveBeenCalled();
    expect(tun.deactivate).toHaveBeenCalled();
    expect(xrayStop).toHaveBeenCalled();
  });

  it('start fully tears down then prepares, starts Xray, and activates', async () => {
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

    expect(tun.deactivate).toHaveBeenCalled();
    expect(proxy.deactivate).toHaveBeenCalled();
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

  it('stop restores both network paths', async () => {
    const proxy = fakeNetwork('proxy');
    const tun = fakeNetwork('tun');
    const runtime = createConnectionRuntime({
      xray: { start: vi.fn(), stop: vi.fn(), isRunning: () => false },
      proxy,
      tun,
    });

    await runtime.stop();

    expect(tun.deactivate).toHaveBeenCalled();
    expect(proxy.deactivate).toHaveBeenCalled();
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

    expect(tun.deactivate).toHaveBeenCalled();
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

  it('starts the next Xray on staging ports before retargeting system proxy', async () => {
    const proxy = fakeNetwork('proxy');
    const tun = fakeNetwork('tun');
    const start = vi.fn(async () => undefined);
    const startStaging = vi.fn(async () => undefined);
    const commitStaging = vi.fn();
    const abortStaging = vi.fn();
    const stop = vi.fn();
    const validate = vi.fn(async () => true);
    const runtime = createConnectionRuntime({
      xray: {
        start,
        stop,
        isRunning: () => true,
        startStaging,
        commitStaging,
        abortStaging,
        getActivePorts: () => ({ socks: 10808, http: 10809, api: 10810 }),
      },
      proxy,
      tun,
      validator: { validate },
    });

    await runtime.start(spec('proxy', 'a'));
    start.mockClear();
    stop.mockClear();
    proxy.deactivate.mockClear();
    await runtime.switch(spec('proxy', 'b'));

    expect(startStaging).toHaveBeenCalledWith(
      expect.objectContaining({ uuid: 'b' }),
      'proxy',
      expect.objectContaining({
        ports: { socks: 10818, http: 10819, api: 10820 },
      }),
    );
    expect(proxy.activate).toHaveBeenCalled();
    expect(commitStaging).toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
    expect(abortStaging).not.toHaveBeenCalled();
  });

  it('aborts staging Xray and keeps the old proxy when validation fails', async () => {
    const proxy = fakeNetwork('proxy');
    const tun = fakeNetwork('tun');
    const startStaging = vi.fn(async () => undefined);
    const commitStaging = vi.fn();
    const abortStaging = vi.fn();
    const stop = vi.fn();
    const runtime = createConnectionRuntime({
      xray: {
        start: vi.fn(async () => undefined),
        stop,
        isRunning: () => true,
        startStaging,
        commitStaging,
        abortStaging,
      },
      proxy,
      tun,
      validator: { validate: vi.fn(async () => false) },
    });

    await runtime.start(spec('proxy', 'a'));
    stop.mockClear();
    proxy.activate.mockClear();
    await expect(runtime.switch(spec('proxy', 'b'))).rejects.toThrow(
      /validation failed/,
    );

    expect(startStaging).toHaveBeenCalled();
    expect(commitStaging).not.toHaveBeenCalled();
    expect(abortStaging).toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
    expect(proxy.activate).not.toHaveBeenCalled();
  });

  it('retargets system proxy back to the old ports if commit fails after activate', async () => {
    const proxy = fakeNetwork('proxy');
    const tun = fakeNetwork('tun');
    const abortStaging = vi.fn();
    const runtime = createConnectionRuntime({
      xray: {
        start: vi.fn(async () => undefined),
        stop: vi.fn(),
        isRunning: () => true,
        startStaging: vi.fn(async () => undefined),
        commitStaging: vi.fn(() => {
          throw new Error('No staging Xray process to commit');
        }),
        abortStaging,
      },
      proxy,
      tun,
      validator: { validate: vi.fn(async () => true) },
    });

    await runtime.start(spec('proxy', 'a'));
    proxy.activate.mockClear();
    await expect(runtime.switch(spec('proxy', 'b'))).rejects.toThrow(
      /No staging Xray process/,
    );

    expect(proxy.activate).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        spec: expect.objectContaining({
          ports: { socks: 10818, http: 10819, api: 10820 },
        }),
      }),
    );
    expect(proxy.activate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        spec: expect.objectContaining({
          ports: { socks: 10808, http: 10809, api: 10810 },
        }),
      }),
    );
    expect(abortStaging).toHaveBeenCalled();
  });

  it('restores the old system proxy if retarget throws after mutating OS settings', async () => {
    const proxy = fakeNetwork('proxy');
    const tun = fakeNetwork('tun');
    const abortStaging = vi.fn();
    proxy.activate.mockImplementation(async (prepared: PreparedConnection) => {
      if (prepared.spec.ports.socks === 10818) {
        throw new Error('proxy enable failed');
      }
    });
    const runtime = createConnectionRuntime({
      xray: {
        start: vi.fn(async () => undefined),
        stop: vi.fn(),
        isRunning: () => true,
        startStaging: vi.fn(async () => undefined),
        commitStaging: vi.fn(),
        abortStaging,
      },
      proxy,
      tun,
      validator: { validate: vi.fn(async () => true) },
    });

    await runtime.start(spec('proxy', 'a'));
    await expect(runtime.switch(spec('proxy', 'b'))).rejects.toThrow(
      /proxy enable failed/,
    );

    expect(proxy.activate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        spec: expect.objectContaining({
          ports: { socks: 10808, http: 10809, api: 10810 },
        }),
      }),
    );
    expect(abortStaging).toHaveBeenCalled();
  });
});
