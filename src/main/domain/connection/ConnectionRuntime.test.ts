import { describe, expect, it, vi } from 'vitest';
import { makeServer } from '@/test/factories';
import { createConnectionRuntime } from './ConnectionRuntime';
import type { ConnectionSpec } from './ConnectionSpec';
import type { NetworkModeRuntime, PreparedConnection } from './NetworkModeRuntime';

function fakeNetwork(mode: 'proxy' | 'tun'): NetworkModeRuntime & {
  prepare: ReturnType<typeof vi.fn>;
  activate: ReturnType<typeof vi.fn>;
  deactivate: ReturnType<typeof vi.fn>;
} {
  const prepare = vi.fn(async (spec: ConnectionSpec): Promise<PreparedConnection> => ({
    spec,
    server: spec.server,
  }));
  const activate = vi.fn(async () => undefined);
  const deactivate = vi.fn(async () => undefined);
  return { mode, prepare, activate, deactivate };
}

function spec(mode: ConnectionSpec['mode'] = 'proxy', uuid = 'server-1'): ConnectionSpec {
  return {
    server: makeServer({ uuid }),
    mode,
    ports: { http: 10809, socks: 10808 },
  };
}

describe('ConnectionRuntime', () => {
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
    expect(xrayStart).toHaveBeenCalledWith(connection.server, 'proxy', undefined);
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
      xray: { start: vi.fn(async () => undefined), stop: vi.fn(), isRunning: () => true },
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
      xray: { start: vi.fn(async () => undefined), stop: vi.fn(), isRunning: () => true },
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
      xray: { start: vi.fn(async () => undefined), stop: vi.fn(), isRunning: () => true },
      proxy,
      tun,
      validator: { validate: vi.fn(async () => false) },
    });

    await runtime.start(spec('proxy', 'a'));
    await expect(runtime.switch(spec('proxy', 'b'))).rejects.toThrow(
      /validation failed/,
    );
  });
});
