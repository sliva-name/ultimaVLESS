import os from 'os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isHostInternetUnavailable } from '@/main/services/connectionMonitor/healthProbe';
import { probeInternetFromLocalAddresses } from '@/main/services/networkProbe';
import {
  TUN_ADDRESS,
  TUN_INTERFACE_NAME,
} from '@/main/services/tunRoute/constants';

vi.mock('@/main/services/networkProbe', () => ({
  probeDirectInternetConnectivity: vi.fn(async () => true),
  probeHttpThroughProxy: vi.fn(),
  probeInternetFromLocalAddresses: vi.fn(async () => true),
  probeTcpPort: vi.fn(),
}));

const uplinkProbe = vi.mocked(probeInternetFromLocalAddresses);

function ipv4(address: string): os.NetworkInterfaceInfo {
  return {
    address,
    netmask: '255.255.255.0',
    family: 'IPv4',
    mac: '00:00:00:00:00:00',
    internal: false,
    cidr: `${address}/24`,
  };
}

function stubInterfaces(
  interfaces: Record<string, os.NetworkInterfaceInfo[]>,
): void {
  vi.spyOn(os, 'networkInterfaces').mockReturnValue(interfaces);
}

afterEach(() => {
  vi.restoreAllMocks();
  uplinkProbe.mockReset();
  uplinkProbe.mockResolvedValue(true);
});

describe('host internet check in TUN mode', () => {
  it('is offline without a non-TUN address, before any probe', async () => {
    stubInterfaces({
      [TUN_INTERFACE_NAME]: [ipv4(TUN_ADDRESS)],
      'Беспроводная сеть': [ipv4('169.254.10.20')],
    });

    await expect(isHostInternetUnavailable('tun', 'win32')).resolves.toBe(true);
    expect(uplinkProbe).not.toHaveBeenCalled();
  });

  it('on Windows is offline when the adapter keeps its address but the uplink is gone', async () => {
    stubInterfaces({
      [TUN_INTERFACE_NAME]: [ipv4(TUN_ADDRESS)],
      'Беспроводная сеть': [ipv4('192.168.0.105')],
    });
    uplinkProbe.mockResolvedValue(false);

    await expect(isHostInternetUnavailable('tun', 'win32')).resolves.toBe(true);
    expect(uplinkProbe).toHaveBeenCalledWith(['192.168.0.105']);
  });

  it('on Windows is online when a bound probe gets through', async () => {
    stubInterfaces({
      'Беспроводная сеть': [ipv4('192.168.0.105')],
      'vEthernet (Default Switch)': [ipv4('172.20.0.1')],
    });

    await expect(isHostInternetUnavailable('tun', 'win32')).resolves.toBe(
      false,
    );
    expect(uplinkProbe).toHaveBeenCalledWith(['192.168.0.105', '172.20.0.1']);
  });

  it('elsewhere trusts the adapter address: a bound socket would enter TUN', async () => {
    stubInterfaces({ en0: [ipv4('192.168.0.105')] });

    await expect(isHostInternetUnavailable('tun', 'darwin')).resolves.toBe(
      false,
    );
    expect(uplinkProbe).not.toHaveBeenCalled();
  });
});
