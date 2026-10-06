import { describe, expect, it, vi } from 'vitest';
import {
  ConflictingAppsService,
  matchConflictingApps,
  parseTasklistCsv,
  type RunningProcess,
} from '@/main/services/ConflictingAppsService';
import { CONFLICTING_APPS } from '@/main/services/conflictingApps/catalog';
import type { CommandOutput } from '@/main/services/platform/commandRunner';

function tasklist(processes: RunningProcess[]): string {
  return processes
    .map(({ image, pid }) => `"${image}","${pid}","Console","1","12${pid} K"`)
    .join('\r\n');
}

function createService(options: {
  processes: () => RunningProcess[];
  ownPids?: number[];
  onTaskkill?: (args: string[]) => void;
}) {
  const calls: string[][] = [];
  const run = vi.fn(
    async (command: string, args: string[]): Promise<CommandOutput> => {
      calls.push([command, ...args]);
      if (command === 'taskkill') options.onTaskkill?.(args);
      return {
        code: 0,
        stdout: command === 'tasklist' ? tasklist(options.processes()) : '',
        stderr: '',
      };
    },
  );
  const service = new ConflictingAppsService({
    platform: 'win32',
    run,
    ownProcessIds: () => options.ownPids ?? [],
    selfPid: 1000,
    sleep: async () => undefined,
  });
  return { service, calls, run };
}

describe('tasklist parsing', () => {
  it('reads image and PID from the CSV, ignoring localized columns', () => {
    expect(
      parseTasklistCsv(
        [
          '"System Idle Process","0","Services","0","8 K"',
          '"v2rayN.exe","4242","Console","1","120 340 K"',
          '"Mullvad VPN.exe","77","Console","1","1 K"',
          '"odd""name.exe","88","Console","1","1 K"',
          'ИНФОРМАЦИЯ: задачи, отвечающие заданным критериям, отсутствуют.',
        ].join('\r\n'),
      ),
    ).toEqual([
      { image: 'v2rayN.exe', pid: 4242 },
      { image: 'Mullvad VPN.exe', pid: 77 },
      { image: 'odd"name.exe', pid: 88 },
    ]);
  });
});

describe('conflicting app matching', () => {
  it('groups processes per product and separates services', () => {
    const apps = matchConflictingApps(
      [
        { image: 'NordVPN.exe', pid: 10 },
        { image: 'nordvpn-service.exe', pid: 11 },
        { image: 'wireguard.exe', pid: 12 },
        { image: 'winws.exe', pid: 13 },
        { image: 'explorer.exe', pid: 14 },
      ],
      CONFLICTING_APPS,
      new Set(),
    );

    // Catalog order, not process order.
    expect(apps).toEqual([
      {
        id: 'wireguard',
        name: 'WireGuard',
        category: 'vpn',
        processes: [],
        services: [{ pid: 12, image: 'wireguard.exe' }],
      },
      {
        id: 'nordvpn',
        name: 'NordVPN',
        category: 'vpn',
        processes: [{ pid: 10, image: 'NordVPN.exe' }],
        services: [{ pid: 11, image: 'nordvpn-service.exe' }],
      },
      {
        id: 'zapret',
        name: 'zapret (winws)',
        category: 'dpi',
        processes: [{ pid: 13, image: 'winws.exe' }],
        services: [],
      },
    ]);
  });

  it('recognizes v2RayTun by its GUI and by the cores it ships', () => {
    const apps = matchConflictingApps(
      [
        { image: 'v2RayTun.exe', pid: 22504 },
        { image: 'xraycore.exe', pid: 22510 },
        { image: 'libhost.exe', pid: 22511 },
      ],
      CONFLICTING_APPS,
      new Set(),
    );

    expect(apps).toEqual([
      expect.objectContaining({
        id: 'v2raytun',
        processes: [
          { pid: 22504, image: 'v2RayTun.exe' },
          { pid: 22510, image: 'xraycore.exe' },
          { pid: 22511, image: 'libhost.exe' },
        ],
      }),
    ]);
  });

  it('keeps catalog ids unique and image names lower-case', () => {
    const ids = CONFLICTING_APPS.map((app) => app.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const app of CONFLICTING_APPS) {
      for (const image of [...app.images, ...(app.services ?? [])]) {
        expect(image).toBe(image.toLowerCase());
        expect(image.endsWith('.exe')).toBe(true);
      }
    }
  });
});

describe('ConflictingAppsService', () => {
  it('is Windows-only', async () => {
    const service = new ConflictingAppsService({ platform: 'linux' });
    await expect(service.scan()).resolves.toEqual({
      supported: false,
      apps: [],
    });
  });

  it('tells our own Xray processes from another client’s by PID', async () => {
    const { service, calls } = createService({
      processes: () => [
        { image: 'xray.exe', pid: 200 },
        { image: 'xray.exe', pid: 201 },
        { image: 'xray.exe', pid: 202 },
        { image: 'v2rayN.exe', pid: 300 },
      ],
      // The connection core and a real-delay probe.
      ownPids: [200, 202],
    });

    const scan = await service.scan();

    expect(scan.supported).toBe(true);
    expect(scan.apps.map((app) => app.id)).toEqual(['v2rayn', 'core-xray']);
    expect(scan.apps[1].processes).toEqual([{ pid: 201, image: 'xray.exe' }]);
    // A single tasklist call — no PowerShell round trip that could time out.
    expect(calls).toEqual([['tasklist', '/FO', 'CSV', '/NH']]);
  });

  it('gives the same answer on every scan', async () => {
    const { service } = createService({
      processes: () => [
        { image: 'xray.exe', pid: 201 },
        { image: 'Windscribe.exe', pid: 50 },
      ],
    });

    const scans = await Promise.all([
      service.scan(),
      service.scan(),
      service.scan(),
    ]);

    for (const scan of scans) {
      expect(scan.apps.map((app) => app.id)).toEqual([
        'windscribe',
        'core-xray',
      ]);
    }
  });

  it('closes politely first and stops there when that works', async () => {
    let running: RunningProcess[] = [
      { image: 'v2rayN.exe', pid: 300 },
      { image: 'explorer.exe', pid: 1 },
    ];
    const { service, calls } = createService({
      processes: () => running,
      onTaskkill: () => {
        running = running.filter((proc) => proc.pid !== 300);
      },
    });

    const result = await service.close('v2rayn');

    expect(result.closed).toBe(true);
    expect(result.remaining).toEqual([]);
    expect(result.scan.apps).toEqual([]);
    expect(calls.filter(([command]) => command === 'taskkill')).toEqual([
      ['taskkill', '/T', '/PID', '300'],
    ]);
  });

  it('forces survivors and leaves services alone', async () => {
    let running: RunningProcess[] = [
      { image: 'NordVPN.exe', pid: 10 },
      { image: 'nordvpn-service.exe', pid: 11 },
    ];
    const { service, calls } = createService({
      processes: () => running,
      onTaskkill: (args) => {
        if (args.includes('/F')) {
          running = running.filter((proc) => proc.pid !== 10);
        }
      },
    });

    const result = await service.close('nordvpn');

    expect(calls.filter(([command]) => command === 'taskkill')).toEqual([
      ['taskkill', '/T', '/PID', '10'],
      ['taskkill', '/F', '/T', '/PID', '10'],
    ]);
    expect(result.closed).toBe(true);
    expect(result.scan.apps).toEqual([
      expect.objectContaining({
        id: 'nordvpn',
        processes: [],
        services: [{ pid: 11, image: 'nordvpn-service.exe' }],
      }),
    ]);
  });

  it('reports processes that survive even a forced kill', async () => {
    const { service } = createService({
      processes: () => [{ image: 'winws.exe', pid: 13 }],
    });

    const result = await service.close('zapret');

    expect(result.closed).toBe(false);
    expect(result.remaining).toEqual([{ pid: 13, image: 'winws.exe' }]);
  });

  it('starts a fresh TUN check per attempt and fills it in the background', async () => {
    let running: RunningProcess[] = [{ image: 'v2rayN.exe', pid: 300 }];
    const { service } = createService({ processes: () => running });
    const changes: Array<ReturnType<typeof service.getTunCheck>> = [];
    service.on('tun-check-changed', () => changes.push(service.getTunCheck()));

    expect(service.getTunCheck()).toBeNull();
    service.startTunCheck();
    expect(service.getTunCheck()).toEqual({
      id: 1,
      scan: null,
      resolved: false,
    });
    await vi.waitFor(() =>
      expect(service.getTunCheck()?.scan?.apps.map((app) => app.id)).toEqual([
        'v2rayn',
      ]),
    );

    running = [];
    service.startTunCheck();
    expect(service.getTunCheck()).toMatchObject({ id: 2, scan: null });
    await vi.waitFor(() =>
      expect(service.getTunCheck()?.scan).toEqual({
        supported: true,
        apps: [],
      }),
    );
    expect(changes.map((check) => check?.id)).toEqual([1, 1, 2, 2]);
  });

  it('marks the TUN check resolved once the user closes an app', async () => {
    let running: RunningProcess[] = [{ image: 'v2rayN.exe', pid: 300 }];
    const { service } = createService({
      processes: () => running,
      onTaskkill: () => {
        running = [];
      },
    });
    service.startTunCheck();
    await vi.waitFor(() => expect(service.getTunCheck()?.scan).not.toBeNull());

    await service.close('v2rayn');

    expect(service.getTunCheck()).toEqual({
      id: 1,
      scan: { supported: true, apps: [] },
      resolved: true,
    });
  });

  it('does not let an older scan overwrite a newer TUN check result', async () => {
    let release: (() => void) | null = null;
    let calls = 0;
    const service = new ConflictingAppsService({
      platform: 'win32',
      ownProcessIds: () => [],
      selfPid: 1000,
      run: async () => {
        calls += 1;
        if (calls === 1) {
          // The first scan sees v2rayN but answers last.
          await new Promise<void>((resolve) => {
            release = resolve;
          });
          return {
            code: 0,
            stdout: tasklist([{ image: 'v2rayN.exe', pid: 300 }]),
            stderr: '',
          };
        }
        return { code: 0, stdout: '', stderr: '' };
      },
    });

    service.startTunCheck();
    await service.scan();
    expect(service.getTunCheck()?.scan?.apps).toEqual([]);
    release!();
    await vi.waitFor(() => expect(calls).toBe(2));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(service.getTunCheck()?.scan?.apps).toEqual([]);
  });

  it('never starts a TUN check outside Windows', () => {
    const service = new ConflictingAppsService({ platform: 'linux' });
    service.startTunCheck();
    expect(service.getTunCheck()).toBeNull();
  });

  it('refuses ids outside the catalog and never kills itself', async () => {
    const { service, calls } = createService({
      processes: () => [{ image: 'v2rayN.exe', pid: 1000 }],
    });

    await expect(service.close('explorer')).rejects.toThrow(
      'Unknown application',
    );
    const result = await service.close('v2rayn');
    expect(result.closed).toBe(true);
    expect(calls.some(([command]) => command === 'taskkill')).toBe(false);
  });
});
