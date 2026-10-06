import { describe, expect, it, vi } from 'vitest';
import type { CommandOutput } from '@/main/services/platform/commandRunner';
import {
  createWindowsNativeRouting,
  describeNetworkAdapters,
  hostAddressFromPrefix,
  listHostInterfaces,
  parseNetshDefaultRoutes,
  parseRoutePrint,
  selectDefaultRoute,
  supportsNativeHostRoutes,
  type CommandRunner,
} from '@/main/services/tunRoute/windowsNativeRouting';

// Captured from a Russian Windows 11 host while TUN was up. Headers are
// localized (and arrive as OEM mojibake through a UTF-8 pipe); only the
// numeric rows matter to the parser.
const ROUTE_PRINT = `
===========================================================================
Список интерфейсов
 18...........................Wintun Tunnel
 17...30 56 0f 57 6f 8b ......Realtek Gaming 2.5GbE Family Controller
  6...98 fe 3e 3d f8 b1 ......Microsoft Wi-Fi Direct Virtual Adapter
 11...9a fe 3e 3d f8 b0 ......Microsoft Wi-Fi Direct Virtual Adapter #2
 10...98 fe 3e 3d f8 b0 ......Intel(R) Wi-Fi 6E AX210 160MHz
  1...........................Software Loopback Interface 1
 45...00 15 5d 08 e6 0d ......Hyper-V Virtual Ethernet Adapter
===========================================================================

IPv4 таблица маршрута
===========================================================================
Активные маршруты:
Сетевой адрес           Маска сети      Адрес шлюза       Интерфейс  Метрика
          0.0.0.0          0.0.0.0      192.168.0.1    192.168.0.124     35
          0.0.0.0          0.0.0.0         On-link        172.19.0.1      0
   89.105.200.136  255.255.255.255      192.168.0.1    192.168.0.124     36
        127.0.0.0        255.0.0.0         On-link         127.0.0.1    331
     172.21.176.0    255.255.240.0         On-link      172.21.176.1   5256
      192.168.0.0    255.255.255.0         On-link     192.168.0.124    291
===========================================================================
Постоянные маршруты:
  Сетевой адрес            Маска    Адрес шлюза      Метрика
   89.105.200.136  255.255.255.255      192.168.0.1       1
===========================================================================
`;

const NETSH_ROUTES = `
Публикация  Тип       Мет  Префикс                   Idx  Шлюз/имя интерфейса
----------  --------  ---  ------------------------  ---  ------------------------
Нет         Вручную   0    0.0.0.0/0                  10  192.168.0.1
Нет         Вручную   0    0.0.0.0/0                  18  ultima0
Нет         Система   256  127.0.0.0/8                 1  Loopback Pseudo-Interface 1
Нет         Система   256  192.168.0.0/24             10  Беспроводная сеть
`;

const HOST_INTERFACES = [
  { name: 'ultima0', address: '172.19.0.1', mac: null, internal: false },
  {
    name: 'Беспроводная сеть',
    address: '192.168.0.124',
    mac: '98:fe:3e:3d:f8:b0',
    internal: false,
  },
  {
    name: 'Loopback Pseudo-Interface 1',
    address: '127.0.0.1',
    mac: null,
    internal: true,
  },
  {
    name: 'vEthernet (WSL (Hyper-V firewall))',
    address: '172.21.176.1',
    mac: '00:15:5d:08:e6:0d',
    internal: false,
  },
];

describe('route print parsing', () => {
  it('reads the interface list with MACs and the gateway routes only', () => {
    const parsed = parseRoutePrint(ROUTE_PRINT);

    expect(parsed.interfaces).toEqual(
      expect.arrayContaining([
        { index: 18, mac: null, description: 'Wintun Tunnel' },
        {
          index: 10,
          mac: '98:fe:3e:3d:f8:b0',
          description: 'Intel(R) Wi-Fi 6E AX210 160MHz',
        },
        { index: 1, mac: null, description: 'Software Loopback Interface 1' },
      ]),
    );
    expect(parsed.interfaces).toHaveLength(7);
    // On-link rows have no gateway address; persistent rows have no interface.
    expect(parsed.activeRoutes).toEqual([
      {
        destination: '0.0.0.0',
        netmask: '0.0.0.0',
        gateway: '192.168.0.1',
        interfaceAddress: '192.168.0.124',
        metric: 35,
      },
      {
        destination: '89.105.200.136',
        netmask: '255.255.255.255',
        gateway: '192.168.0.1',
        interfaceAddress: '192.168.0.124',
        metric: 36,
      },
    ]);
  });

  it('reads netsh default routes with their interface index', () => {
    expect(parseNetshDefaultRoutes(NETSH_ROUTES)).toEqual([
      { routeMetric: 0, interfaceIndex: 10, gateway: '192.168.0.1' },
    ]);
  });

  it('flattens IPv4 host interfaces and drops the all-zero MAC', () => {
    const interfaces = listHostInterfaces(() => ({
      ultima0: [
        {
          address: '172.19.0.1',
          netmask: '255.255.255.252',
          family: 'IPv4',
          mac: '00:00:00:00:00:00',
          internal: false,
          cidr: '172.19.0.1/30',
        },
      ],
      'Wi-Fi': [
        {
          address: 'fe80::1',
          netmask: 'ffff:ffff:ffff:ffff::',
          family: 'IPv6',
          mac: '98:fe:3e:3d:f8:b0',
          internal: false,
          cidr: 'fe80::1/64',
          scopeid: 10,
        },
        {
          address: '192.168.0.124',
          netmask: '255.255.255.0',
          family: 'IPv4',
          mac: '98:FE:3E:3D:F8:B0',
          internal: false,
          cidr: '192.168.0.124/24',
        },
      ],
    }));

    expect(interfaces).toEqual([
      { name: 'ultima0', address: '172.19.0.1', mac: null, internal: false },
      {
        name: 'Wi-Fi',
        address: '192.168.0.124',
        mac: '98:fe:3e:3d:f8:b0',
        internal: false,
      },
    ]);
  });
});

describe('default route selection', () => {
  it('picks the physical uplink and names it from the OS, not the console', () => {
    const selected = selectDefaultRoute({
      routePrint: parseRoutePrint(ROUTE_PRINT),
      netshRoutes: parseNetshDefaultRoutes(NETSH_ROUTES),
      hostInterfaces: HOST_INTERFACES,
    });

    expect(selected).toEqual({
      interfaceIndex: 10,
      gateway: '192.168.0.1',
      interfaceName: 'Беспроводная сеть',
      localAddress: '192.168.0.124',
    });
  });

  it('prefers a physical adapter over a virtual switch with a better metric', () => {
    const routePrint = parseRoutePrint(`
 45...00 15 5d 08 e6 0d ......Hyper-V Virtual Ethernet Adapter
 10...98 fe 3e 3d f8 b0 ......Intel(R) Wi-Fi 6E AX210 160MHz
          0.0.0.0          0.0.0.0     172.21.176.254     172.21.176.1      5
          0.0.0.0          0.0.0.0      192.168.0.1    192.168.0.124     35
`);
    const selected = selectDefaultRoute({
      routePrint,
      netshRoutes: [
        { routeMetric: 0, interfaceIndex: 45, gateway: '172.21.176.254' },
        { routeMetric: 0, interfaceIndex: 10, gateway: '192.168.0.1' },
      ],
      hostInterfaces: HOST_INTERFACES,
    });

    expect(selected?.interfaceIndex).toBe(10);
  });

  it('ranks two physical uplinks by effective metric', () => {
    const routePrint = parseRoutePrint(`
 17...30 56 0f 57 6f 8b ......Realtek Gaming 2.5GbE Family Controller
 10...98 fe 3e 3d f8 b0 ......Intel(R) Wi-Fi 6E AX210 160MHz
          0.0.0.0          0.0.0.0      192.168.0.1    192.168.0.124     35
          0.0.0.0          0.0.0.0      10.0.0.1          10.0.0.7     25
`);
    const selected = selectDefaultRoute({
      routePrint,
      netshRoutes: [
        { routeMetric: 0, interfaceIndex: 10, gateway: '192.168.0.1' },
        { routeMetric: 0, interfaceIndex: 17, gateway: '10.0.0.1' },
      ],
      hostInterfaces: [
        ...HOST_INTERFACES,
        {
          name: 'Ethernet',
          address: '10.0.0.7',
          mac: '30:56:0f:57:6f:8b',
          internal: false,
        },
      ],
    });

    expect(selected).toMatchObject({
      interfaceIndex: 17,
      gateway: '10.0.0.1',
      interfaceName: 'Ethernet',
    });
  });

  it('resolves the index through the adapter MAC when two uplinks share a gateway', () => {
    const routePrint = parseRoutePrint(`
 17...30 56 0f 57 6f 8b ......Realtek Gaming 2.5GbE Family Controller
 10...98 fe 3e 3d f8 b0 ......Intel(R) Wi-Fi 6E AX210 160MHz
          0.0.0.0          0.0.0.0      192.168.0.1    192.168.0.124     35
          0.0.0.0          0.0.0.0      192.168.0.1     192.168.0.50     25
`);
    const selected = selectDefaultRoute({
      routePrint,
      netshRoutes: [
        { routeMetric: 0, interfaceIndex: 10, gateway: '192.168.0.1' },
        { routeMetric: 0, interfaceIndex: 17, gateway: '192.168.0.1' },
      ],
      hostInterfaces: [
        ...HOST_INTERFACES,
        {
          name: 'Ethernet',
          address: '192.168.0.50',
          mac: '30:56:0f:57:6f:8b',
          internal: false,
        },
      ],
    });

    expect(selected).toMatchObject({
      interfaceIndex: 17,
      localAddress: '192.168.0.50',
    });
  });

  it('never returns our own TUN adapter or an address it cannot map to an index', () => {
    const routePrint = parseRoutePrint(`
 18...........................Wintun Tunnel
          0.0.0.0          0.0.0.0       172.19.0.2       172.19.0.1      0
          0.0.0.0          0.0.0.0      192.168.0.1    192.168.0.124     35
`);
    expect(
      selectDefaultRoute({
        routePrint,
        netshRoutes: [
          { routeMetric: 0, interfaceIndex: 18, gateway: '172.19.0.2' },
        ],
        hostInterfaces: HOST_INTERFACES,
      }),
    ).toBeNull();
  });
});

// The adapter set from the bug report: two wired NICs, Wi-Fi as the real
// uplink, VirtualBox/Hyper-V host networks and an OpenVPN TAP. Xray's own
// Windows heuristic (name contains "wi-fi", address 192.168.*) cannot pick
// "Беспроводная сеть" here; the routing table can.
const MULTI_ADAPTER_ROUTE_PRINT = `
 12...0a 00 27 00 00 0c ......VirtualBox Host-Only Ethernet Adapter
 10...98 fe 3e 3d f8 b0 ......Intel(R) Wi-Fi 6E AX210 160MHz
 17...30 56 0f 57 6f 8b ......Realtek PCIe GbE Family Controller
 19...30 56 0f 57 6f 8c ......Realtek USB GbE Family Controller
 21...00 ff 6a 1b 2c 3d ......TAP-Windows Adapter V9
 45...00 15 5d 08 e6 0d ......Hyper-V Virtual Ethernet Adapter
          0.0.0.0          0.0.0.0      192.168.0.1    192.168.0.124     35
          0.0.0.0          0.0.0.0       10.20.0.1       10.20.0.15     45
`;

const MULTI_ADAPTER_NETSH = [
  { routeMetric: 0, interfaceIndex: 10, gateway: '192.168.0.1' },
  { routeMetric: 0, interfaceIndex: 19, gateway: '10.20.0.1' },
];

const MULTI_ADAPTER_HOSTS = [
  { name: 'ultima0', address: '172.19.0.1', mac: null, internal: false },
  {
    name: 'Loopback Pseudo-Interface 1',
    address: '127.0.0.1',
    mac: null,
    internal: true,
  },
  {
    name: 'Ethernet',
    address: '169.254.10.20',
    mac: '30:56:0f:57:6f:8b',
    internal: false,
  },
  {
    name: 'Ethernet 2',
    address: '10.20.0.15',
    mac: '30:56:0f:57:6f:8c',
    internal: false,
  },
  {
    name: 'Беспроводная сеть',
    address: '192.168.0.124',
    mac: '98:fe:3e:3d:f8:b0',
    internal: false,
  },
  {
    name: 'VirtualBox Host-Only Network',
    address: '192.168.56.1',
    mac: '0a:00:27:00:00:0c',
    internal: false,
  },
  {
    name: 'vEthernet (Default Switch)',
    address: '172.21.176.1',
    mac: '00:15:5d:08:e6:0d',
    internal: false,
  },
  {
    name: 'OpenVPN TAP',
    address: '10.8.0.6',
    mac: '00:ff:6a:1b:2c:3d',
    internal: false,
  },
];

const MULTI_ADAPTER_TABLES = {
  routePrint: parseRoutePrint(MULTI_ADAPTER_ROUTE_PRINT),
  netshRoutes: MULTI_ADAPTER_NETSH,
  hostInterfaces: MULTI_ADAPTER_HOSTS,
};

describe('preferred TUN adapter', () => {
  it('follows the routing table when nothing is selected', () => {
    expect(selectDefaultRoute(MULTI_ADAPTER_TABLES)).toMatchObject({
      interfaceIndex: 10,
      interfaceName: 'Беспроводная сеть',
    });
  });

  it('uses the selected adapter even when another one has a better metric', () => {
    expect(
      selectDefaultRoute({
        ...MULTI_ADAPTER_TABLES,
        preferredInterface: 'Ethernet 2',
      }),
    ).toEqual({
      interfaceIndex: 19,
      gateway: '10.20.0.1',
      interfaceName: 'Ethernet 2',
      localAddress: '10.20.0.15',
    });
  });

  it('returns nothing for a selected adapter without a default route', () => {
    for (const preferredInterface of [
      'VirtualBox Host-Only Network',
      'Ethernet',
      'Ethernet 7',
    ]) {
      expect(
        selectDefaultRoute({ ...MULTI_ADAPTER_TABLES, preferredInterface }),
      ).toBeNull();
    }
  });
});

describe('network adapter listing', () => {
  it('lists every adapter but our TUN, the automatic choice first', () => {
    const adapters = describeNetworkAdapters(MULTI_ADAPTER_TABLES);

    expect(adapters.map((adapter) => adapter.name)).toEqual([
      'Беспроводная сеть',
      'Ethernet 2',
      'Ethernet',
      'vEthernet (Default Switch)',
      'VirtualBox Host-Only Network',
      'OpenVPN TAP',
    ]);
    expect(adapters[0]).toEqual({
      name: 'Беспроводная сеть',
      description: 'Intel(R) Wi-Fi 6E AX210 160MHz',
      ipv4: ['192.168.0.124'],
      gateway: '192.168.0.1',
      kind: 'physical',
      isAutomaticChoice: true,
    });
    expect(
      adapters.filter((adapter) => adapter.isAutomaticChoice),
    ).toHaveLength(1);
    expect(adapters.find((a) => a.name === 'Ethernet')).toMatchObject({
      description: 'Realtek PCIe GbE Family Controller',
      gateway: null,
      kind: 'physical',
    });
    expect(
      adapters.find((a) => a.name === 'VirtualBox Host-Only Network'),
    ).toMatchObject({ gateway: null, kind: 'virtual' });
    expect(adapters.find((a) => a.name === 'OpenVPN TAP')).toMatchObject({
      description: 'TAP-Windows Adapter V9',
      kind: 'vpn',
    });
  });

  it('merges addresses per adapter and drops unreadable descriptions', () => {
    const adapters = describeNetworkAdapters({
      routePrint: parseRoutePrint(`
 10...98 fe 3e 3d f8 b0 ......\uFFFD\uFFFD\uFFFD\uFFFD Wi-Fi
`),
      netshRoutes: [],
      hostInterfaces: [
        {
          name: 'Wi-Fi',
          address: '192.168.0.124',
          mac: '98:fe:3e:3d:f8:b0',
          internal: false,
        },
        {
          name: 'Wi-Fi',
          address: '192.168.7.3',
          mac: '98:fe:3e:3d:f8:b0',
          internal: false,
        },
      ],
    });

    expect(adapters).toEqual([
      {
        name: 'Wi-Fi',
        description: null,
        ipv4: ['192.168.0.124', '192.168.7.3'],
        gateway: null,
        kind: 'physical',
        isAutomaticChoice: false,
      },
    ]);
  });

  it('reads the tables through route.exe and netsh', async () => {
    const run: CommandRunner = vi.fn(async (command: string) => ({
      code: 0,
      stdout:
        command === 'route'
          ? MULTI_ADAPTER_ROUTE_PRINT
          : `Нет  Вручную  0  0.0.0.0/0  10  192.168.0.1`,
      stderr: '',
    }));
    const routing = createWindowsNativeRouting(run, () => ({
      'Беспроводная сеть': [
        {
          address: '192.168.0.124',
          netmask: '255.255.255.0',
          family: 'IPv4',
          mac: '98:fe:3e:3d:f8:b0',
          internal: false,
          cidr: '192.168.0.124/24',
        },
      ],
    }));

    await expect(routing.listAdapters()).resolves.toEqual([
      expect.objectContaining({
        name: 'Беспроводная сеть',
        gateway: '192.168.0.1',
        isAutomaticChoice: true,
      }),
    ]);
    await expect(
      routing.discoverDefaultRoute('Беспроводная сеть'),
    ).resolves.toMatchObject({ interfaceIndex: 10 });
    await expect(routing.discoverDefaultRoute('Ethernet')).resolves.toBeNull();
  });
});

describe('host prefixes', () => {
  it('accepts only IPv4 /32 prefixes for the native path', () => {
    expect(hostAddressFromPrefix('203.0.113.10/32')).toBe('203.0.113.10');
    expect(hostAddressFromPrefix('203.0.113.10')).toBe('203.0.113.10');
    expect(hostAddressFromPrefix('203.0.113.0/24')).toBeNull();
    expect(hostAddressFromPrefix('2001:db8::1/128')).toBeNull();
    expect(supportsNativeHostRoutes(['203.0.113.10/32'])).toBe(true);
    expect(supportsNativeHostRoutes(['2001:db8::1/128'])).toBe(false);
    expect(supportsNativeHostRoutes([])).toBe(false);
  });
});

describe('native route mutations', () => {
  function createRunner(table: () => string) {
    const calls: string[][] = [];
    const run: CommandRunner = vi.fn(
      async (command: string, args: string[]) => {
        calls.push([command, ...args]);
        const output: CommandOutput = { code: 0, stdout: '', stderr: '' };
        if (command === 'route' && args[0] === 'print') {
          output.stdout = table();
        }
        return output;
      },
    );
    return { run, calls };
  }

  it('replaces a stale pin, adds via the gateway and confirms from the table', async () => {
    let pinned = false;
    const { run, calls } = createRunner(() =>
      pinned
        ? `   203.0.113.10  255.255.255.255      192.168.0.1    192.168.0.124     36`
        : '',
    );
    const runWithPin: CommandRunner = async (command, args) => {
      const result = await run(command, args);
      if (args[0] === 'ADD') pinned = true;
      return result;
    };
    const routing = createWindowsNativeRouting(runWithPin, () => ({}));

    const result = await routing.addHostRoutes({
      prefixes: ['203.0.113.10/32'],
      gateway: '192.168.0.1',
      interfaceIndex: 10,
      metric: 1,
    });

    expect(result).toEqual({ created: ['203.0.113.10/32'], failed: [] });
    expect(calls).toEqual([
      ['route', 'DELETE', '203.0.113.10', 'MASK', '255.255.255.255'],
      [
        'route',
        'ADD',
        '203.0.113.10',
        'MASK',
        '255.255.255.255',
        '192.168.0.1',
        'METRIC',
        '1',
        'IF',
        '10',
      ],
      ['route', 'print', '-4'],
    ]);
  });

  it('reports the tool output when the route is missing after ADD', async () => {
    const run: CommandRunner = vi.fn(async (_command, args) => ({
      code: args[0] === 'ADD' ? 1 : 0,
      stdout:
        args[0] === 'ADD'
          ? 'Не удалось добавить маршрут: Запрошенная операция требует повышения.\r\n'
          : '',
      stderr: '',
    }));
    const routing = createWindowsNativeRouting(run, () => ({}));

    const result = await routing.addHostRoutes({
      prefixes: ['203.0.113.10/32'],
      gateway: '192.168.0.1',
      interfaceIndex: 10,
      metric: 1,
    });

    expect(result.created).toEqual([]);
    expect(result.failed).toEqual([
      {
        prefix: '203.0.113.10/32',
        message:
          'Не удалось добавить маршрут: Запрошенная операция требует повышения.',
      },
    ]);
  });

  it('removes pins and reports the ones that survived', async () => {
    const { run, calls } = createRunner(
      () =>
        `   203.0.113.11  255.255.255.255      192.168.0.1    192.168.0.124     36`,
    );
    const routing = createWindowsNativeRouting(run, () => ({}));

    const result = await routing.removeHostRoutes([
      '203.0.113.10/32',
      '203.0.113.11/32',
    ]);

    expect(result).toEqual({ removed: 1, remaining: ['203.0.113.11/32'] });
    expect(calls.filter((call) => call[1] === 'DELETE')).toHaveLength(2);
    expect(calls.at(-1)).toEqual(['route', 'print', '-4']);
  });

  it('returns null instead of throwing when a table cannot be read', async () => {
    const run: CommandRunner = vi.fn(async () => {
      throw new Error('route timed out after 8s');
    });
    const routing = createWindowsNativeRouting(run, () => ({}));

    await expect(routing.discoverDefaultRoute()).resolves.toBeNull();
  });
});
