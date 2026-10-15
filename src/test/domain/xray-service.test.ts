import { EventEmitter } from 'events';
import { spawn } from 'child_process';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { XrayService } from '@/main/services/XrayService';
import { probeTcpPort } from '@/main/services/networkProbe';
import {
  buildConsoleBreakScript,
  sendConsoleBreak,
} from '@/main/services/xray/windowsConsoleBreak';
import { makeServer } from '@/test/factories';

vi.mock('child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('child_process')>()),
  spawn: vi.fn(),
}));
vi.mock('fs/promises', () => ({
  default: {
    writeFile: vi.fn(async () => undefined),
    access: vi.fn(async () => undefined),
    chmod: vi.fn(async () => undefined),
  },
}));
vi.mock('@/main/services/LoggerService', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/main/services/XrayConfigCompiler', () => ({
  XrayConfigCompiler: { compile: vi.fn(() => ({})) },
}));
vi.mock('@/main/services/ConfigService', () => ({
  configService: { getPerformanceSettings: vi.fn(() => ({})) },
}));
vi.mock('@/main/services/networkProbe', () => ({ probeTcpPort: vi.fn() }));
vi.mock('@/main/utils/runtimePaths', () => ({
  getBinResourcesPath: () => '/resources/bin',
}));
vi.mock('@/main/services/PrivilegeService', () => ({
  buildElevatedXrayCommand: vi.fn(),
  findPkexecPath: () => null,
  isProcessRoot: () => false,
  shouldElevateXray: () => false,
}));
vi.mock('@/main/services/xray/windowsConsoleBreak', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/main/services/xray/windowsConsoleBreak')
  >()),
  sendConsoleBreak: vi.fn(),
}));

const XRAY_PID = 4321;

type FakeChild = EventEmitter & {
  pid: number;
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdin: null;
  kill: ReturnType<typeof vi.fn>;
};

function fakeChild(): FakeChild {
  return Object.assign(new EventEmitter(), {
    pid: XRAY_PID,
    exitCode: null,
    signalCode: null,
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    stdin: null,
    kill: vi.fn(() => true),
  });
}

function exitChild(child: FakeChild, code: number): void {
  child.exitCode = code;
  child.emit('exit', code, null);
  child.emit('close', code, null);
}

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform });
}

describe('XrayService on Windows', () => {
  let child: FakeChild;
  let listenersUp: boolean;
  let taskkill: { unref: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.useFakeTimers();
    setPlatform('win32');
    child = fakeChild();
    listenersUp = false;
    taskkill = { unref: vi.fn() };
    vi.mocked(spawn).mockReset();
    vi.mocked(spawn).mockImplementation(((command: string) =>
      /taskkill/i.test(command) ? taskkill : child) as never);
    vi.mocked(probeTcpPort).mockReset();
    vi.mocked(probeTcpPort).mockImplementation(async () => listenersUp);
    vi.mocked(sendConsoleBreak).mockReset();
    vi.mocked(sendConsoleBreak).mockResolvedValue(true);
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', originalPlatform);
    vi.useRealTimers();
  });

  async function startConnected(
    service: XrayService,
    mode: 'proxy' | 'tun',
  ): Promise<void> {
    listenersUp = true;
    const started = service.start(makeServer(), mode);
    await vi.advanceTimersByTimeAsync(0);
    await started;
  }

  describe('readiness budget', () => {
    it('waits past 3 s for TUN listeners while Wintun is being created', async () => {
      const service = new XrayService();
      const started = service.start(makeServer(), 'tun');
      const settled = vi.fn();
      started.then(settled, settled);

      await vi.advanceTimersByTimeAsync(6_000);
      expect(settled).not.toHaveBeenCalled();

      listenersUp = true;
      await vi.advanceTimersByTimeAsync(100);
      await started;
      expect(child.kill).not.toHaveBeenCalled();
      expect(sendConsoleBreak).not.toHaveBeenCalled();
      expect(service.getHealthStatus()).toMatchObject({
        state: 'running',
        ready: true,
      });
    });

    it('still gives up on TUN after the extended budget', async () => {
      const service = new XrayService();
      const started = service.start(makeServer(), 'tun');
      const settled = vi.fn();
      started.then(settled, settled);

      await vi.advanceTimersByTimeAsync(19_500);
      expect(settled).not.toHaveBeenCalled();

      const failure = expect(started).rejects.toThrow(
        'local proxy listeners did not become reachable in time',
      );
      await vi.advanceTimersByTimeAsync(1_000);
      await failure;
      expect(sendConsoleBreak).toHaveBeenCalledWith(XRAY_PID);
    });

    it('keeps the 3 s budget in proxy mode', async () => {
      const service = new XrayService();
      const started = service.start(makeServer(), 'proxy');
      const failure = expect(started).rejects.toThrow(
        'local proxy listeners did not become reachable in time',
      );

      await vi.advanceTimersByTimeAsync(3_500);
      await failure;
      expect(child.kill).toHaveBeenCalledTimes(1);
      expect(sendConsoleBreak).not.toHaveBeenCalled();
    });

    it('reports an Xray exit during a TUN start at once', async () => {
      const service = new XrayService();
      const started = service.start(makeServer(), 'tun');
      const failure = expect(started).rejects.toThrow(
        'Xray exited during startup (code=1',
      );

      await vi.advanceTimersByTimeAsync(500);
      exitChild(child, 1);
      await vi.advanceTimersByTimeAsync(0);
      await failure;
      expect(service.getHealthStatus().state).toBe('failed');
    });
  });

  describe('stop', () => {
    it('spawns Xray with its own hidden console', async () => {
      await startConnected(new XrayService(), 'tun');
      expect(spawn).toHaveBeenCalledWith(
        expect.stringContaining('xray.exe'),
        expect.any(Array),
        expect.objectContaining({ windowsHide: true }),
      );
    });

    it('stops TUN with Ctrl+Break instead of TerminateProcess', async () => {
      const service = new XrayService();
      await startConnected(service, 'tun');

      service.stop();
      await vi.advanceTimersByTimeAsync(0);
      expect(sendConsoleBreak).toHaveBeenCalledWith(XRAY_PID);
      expect(child.kill).not.toHaveBeenCalled();
      expect(service.isRunning()).toBe(true);

      exitChild(child, 0);
      await vi.advanceTimersByTimeAsync(0);
      expect(service.isRunning()).toBe(false);
      expect(service.getHealthStatus().state).toBe('stopped');
    });

    it('kills at once when Ctrl+Break cannot be delivered', async () => {
      vi.mocked(sendConsoleBreak).mockResolvedValue(false);
      const service = new XrayService();
      await startConnected(service, 'tun');

      service.stop();
      await vi.advanceTimersByTimeAsync(0);
      expect(child.kill).toHaveBeenCalledTimes(1);
    });

    it('force-kills TUN Xray that ignores Ctrl+Break', async () => {
      const service = new XrayService();
      await startConnected(service, 'tun');

      service.stop();
      await vi.advanceTimersByTimeAsync(4_900);
      expect(spawn).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(200);
      expect(spawn).toHaveBeenLastCalledWith(
        expect.stringMatching(/taskkill/i),
        ['/pid', String(XRAY_PID), '/T', '/F'],
        expect.anything(),
      );
    });

    it('a new start waits for the graceful TUN stop to finish', async () => {
      const service = new XrayService();
      await startConnected(service, 'tun');
      const previous = child;

      service.stop();
      child = fakeChild();
      const restarted = service.start(makeServer(), 'tun');
      await vi.advanceTimersByTimeAsync(1_000);
      expect(spawn).toHaveBeenCalledTimes(1);

      exitChild(previous, 0);
      await vi.advanceTimersByTimeAsync(100);
      await restarted;
      expect(spawn).toHaveBeenCalledTimes(2);
    });

    it('keeps the immediate kill in proxy mode', async () => {
      const service = new XrayService();
      await startConnected(service, 'proxy');

      service.stop();
      expect(child.kill).toHaveBeenCalledTimes(1);
      expect(sendConsoleBreak).not.toHaveBeenCalled();
    });
  });
});

describe('sendConsoleBreak', () => {
  let realSendConsoleBreak: typeof sendConsoleBreak;

  beforeAll(async () => {
    ({ sendConsoleBreak: realSendConsoleBreak } = await vi.importActual<
      typeof import('@/main/services/xray/windowsConsoleBreak')
    >('@/main/services/xray/windowsConsoleBreak'));
  });

  beforeEach(() => setPlatform('win32'));
  afterEach(() => {
    Object.defineProperty(process, 'platform', originalPlatform);
  });

  function decodedScript(args: string[]): string {
    const encoded = args[args.indexOf('-EncodedCommand') + 1];
    return Buffer.from(encoded, 'base64').toString('utf16le');
  }

  it('raises Ctrl+Break for the PID through PowerShell', async () => {
    const run = vi.fn(async () => ({ code: 0, stdout: '', stderr: '' }));
    await expect(realSendConsoleBreak(XRAY_PID, { run })).resolves.toBe(true);

    const [command, args] = run.mock.calls[0] as unknown as [string, string[]];
    expect(command).toBe('powershell');
    expect(decodedScript(args)).toBe(buildConsoleBreakScript(XRAY_PID, 'xray'));
  });

  it('checks the process name and ignores the event in the helper', () => {
    const script = buildConsoleBreakScript(XRAY_PID, 'xray');
    expect(script).toContain(`Send(${XRAY_PID}, $name)`);
    expect(script).toContain(Buffer.from('xray').toString('base64'));
    expect(script).toContain('GenerateConsoleCtrlEvent(1, 0)');
    expect(script).toContain('SetConsoleCtrlHandler(Ignore, true)');
  });

  it('reports failure on a non-zero exit or a helper error', async () => {
    const refused = vi.fn(async () => ({ code: 4, stdout: '', stderr: '' }));
    await expect(
      realSendConsoleBreak(XRAY_PID, { run: refused }),
    ).resolves.toBe(false);

    const timedOut = vi.fn(async () => {
      throw new Error('powershell timed out after 4s');
    });
    await expect(
      realSendConsoleBreak(XRAY_PID, { run: timedOut }),
    ).resolves.toBe(false);
  });

  it('does nothing off Windows or without a valid PID', async () => {
    const run = vi.fn(async () => ({ code: 0, stdout: '', stderr: '' }));
    await expect(realSendConsoleBreak(0, { run })).resolves.toBe(false);
    setPlatform('linux');
    await expect(realSendConsoleBreak(XRAY_PID, { run })).resolves.toBe(false);
    expect(run).not.toHaveBeenCalled();
  });
});
