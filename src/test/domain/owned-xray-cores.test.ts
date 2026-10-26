import { EventEmitter } from 'events';
import type { ChildProcess } from 'child_process';
import { describe, expect, it, vi } from 'vitest';
import { ConflictingAppsService } from '@/main/services/ConflictingAppsService';
import {
  getOwnedXrayPids,
  trackOwnedXrayProcess,
} from '@/main/services/xray/ownedProcesses';
import { stopOrphanedXrayCores } from '@/main/services/xray/orphanedCores';
import type { CommandOutput } from '@/main/services/platform/commandRunner';

const BINARY = 'C:\\Program Files\\UltimaVLESS\\resources\\bin\\xray.exe';

function fakeChild(pid: number): ChildProcess {
  return Object.assign(new EventEmitter(), { pid }) as unknown as ChildProcess;
}

function output(stdout: string): CommandOutput {
  return { code: 0, stdout, stderr: '' };
}

function tasklistRows(pids: number[]): string {
  return pids
    .map((pid) => `"xray.exe","${pid}","Console","1","12 345 K"`)
    .join('\r\n');
}

describe('own Xray processes', () => {
  it('still counts a core as ours for a while after it exits', () => {
    let now = 1_000;
    const child = fakeChild(4101);
    trackOwnedXrayProcess(child, () => now);
    expect(getOwnedXrayPids(now)).toContain(4101);

    child.emit('exit', 0, null);
    now += 29_000;
    expect(getOwnedXrayPids(now)).toContain(4101);

    now += 2_000;
    expect(getOwnedXrayPids(now)).not.toContain(4101);
  });

  it('does not offer to close our core when it exits during the conflict scan', async () => {
    const probe = fakeChild(4102);
    trackOwnedXrayProcess(probe);
    const service = new ConflictingAppsService({
      platform: 'win32',
      selfPid: 1,
      run: async (command) => {
        // The listing still shows the probe; it is stopped right after,
        // before the scan looks up our PIDs.
        const rows = command === 'tasklist' ? tasklistRows([4102]) : '';
        probe.emit('exit', 0, null);
        return output(rows);
      },
    });

    const scan = await service.scan();

    expect(scan.apps).toEqual([]);
  });
});

describe('Xray left by an earlier instance', () => {
  function setup(options: {
    listed: number[];
    described: string[];
    ownPids?: () => number[];
  }) {
    const calls: string[][] = [];
    const scripts: string[] = [];
    const result = stopOrphanedXrayCores({
      platform: 'win32',
      binaryPath: BINARY,
      selfPid: 77,
      ownPids: options.ownPids ?? (() => []),
      run: async (command, args) => {
        calls.push([command, ...args]);
        return output(
          command === 'tasklist' ? tasklistRows(options.listed) : '',
        );
      },
      runScript: async (script) => {
        scripts.push(script);
        return options.described.join('\r\n');
      },
    });
    return { result, calls, scripts };
  }

  it('stops only cores started from this installation', async () => {
    const { result, calls, scripts } = setup({
      listed: [501, 502, 503],
      described: [
        `501|${BINARY}`,
        // Same name, another client's binary.
        '502|C:\\Users\\me\\v2rayN\\bin\\xray\\xray.exe',
        `503|${BINARY.toUpperCase()}`,
      ],
    });

    await expect(result).resolves.toEqual([501, 503]);
    expect(calls.at(-1)).toEqual([
      'taskkill',
      '/F',
      '/PID',
      '501',
      '/PID',
      '503',
    ]);
    // Only processes of this Windows session are looked at.
    expect(scripts[0]).toContain('Get-Process -Id 77');
    expect(scripts[0]).toContain('$ids = @(501,502,503)');
  });

  it('never touches the cores this instance runs', async () => {
    let own = [601];
    const { result, calls, scripts } = setup({
      listed: [601, 602],
      described: [`602|${BINARY}`],
      // A real-delay probe starts while the paths are being read.
      ownPids: () => {
        const current = own;
        own = [601, 602];
        return current;
      },
    });

    await expect(result).resolves.toEqual([]);
    expect(scripts[0]).toContain('$ids = @(602)');
    expect(calls.some(([command]) => command === 'taskkill')).toBe(false);
  });

  it('asks PowerShell nothing when no foreign xray.exe runs', async () => {
    const { result, scripts } = setup({
      listed: [701],
      described: [],
      ownPids: () => [701],
    });

    await expect(result).resolves.toEqual([]);
    expect(scripts).toEqual([]);
  });

  it('does nothing outside Windows', async () => {
    const run = vi.fn();
    await expect(
      stopOrphanedXrayCores({ platform: 'linux', run }),
    ).resolves.toEqual([]);
    expect(run).not.toHaveBeenCalled();
  });
});
