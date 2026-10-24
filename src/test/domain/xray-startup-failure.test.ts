import { afterEach, describe, expect, it } from 'vitest';
import net from 'net';
import { summarizeStartupFailure } from '@/main/services/xray/startupFailure';
import { findBusyLoopbackPort } from '@/main/services/xray/loopbackPorts';

describe('summarizeStartupFailure', () => {
  // Lines printed by Xray 26.10.21.
  it.each([
    [
      'Failed to start: main: failed to load config files: [/home/u/.config/UltimaVLESS/config.json] > infra/conf: failed to build outbound config with tag proxy > infra/conf: failed to build stream settings for outbound detour > infra/conf: Failed to build TLS config. > infra/conf: unknown "fingerprint": none',
      'Failed to build TLS config. > unknown "fingerprint": none',
    ],
    [
      'Failed to start: app/proxyman/inbound: failed to start proxy > proxy/tun: failed to add interface address fd7a:115c:a1e0::1/126 > operation not supported',
      'failed to add interface address fd7a:115c:a1e0::1/126 > operation not supported',
    ],
    [
      'Failed to start: main: failed to load config files: [/c.json] > infra/conf: vless without TLS or other encryption is prohibited unless the server address is a private IP or domain',
      'vless without TLS or other encryption is prohibited unless the server address is a private IP or domain',
    ],
  ])('summarizes %s', (line, expected) => {
    expect(
      summarizeStartupFailure([
        'Xray 26.10.21 (Xray, Penetrates Everything.)',
        line,
      ]),
    ).toBe(expected);
  });

  it('returns null without a Failed to start line', () => {
    expect(
      summarizeStartupFailure(['[Warning] core: Xray 26.10.21 started']),
    ).toBeNull();
  });
});

describe('findBusyLoopbackPort', () => {
  let holder: net.Server | null = null;

  afterEach(async () => {
    await new Promise<void>((resolve) =>
      holder ? holder.close(() => resolve()) : resolve(),
    );
    holder = null;
  });

  it('reports a port another listener holds and passes free ones', async () => {
    holder = net.createServer();
    await new Promise<void>((resolve) =>
      holder!.listen(0, '127.0.0.1', resolve),
    );
    const taken = (holder.address() as net.AddressInfo).port;

    await expect(findBusyLoopbackPort([taken])).resolves.toEqual({
      port: taken,
      code: 'EADDRINUSE',
    });
    await new Promise<void>((resolve) => holder!.close(() => resolve()));
    holder = null;
    await expect(findBusyLoopbackPort([taken])).resolves.toBeNull();
  });
});
