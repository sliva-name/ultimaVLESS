import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import { spawn } from 'child_process';
import { XrayService } from './XrayService';
import { ConfigGenerator } from './ConfigGenerator';
import { makeServer } from '../../test/factories';
import { createMockChildProcess } from '../../test/mockChildProcess';

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(() => true),
    writeFileSync: vi.fn(),
    appendFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    chmodSync: vi.fn(),
    statSync: vi.fn(() => ({ size: 0 })),
    renameSync: vi.fn(),
    unlinkSync: vi.fn(),
  },
}));

vi.mock('child_process', () => {
  const spawn = vi.fn();
  return {
    spawn,
    default: { spawn },
    __esModule: true,
  };
});

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp'),
    isPackaged: false,
  },
}));

vi.mock('./ConfigGenerator', () => ({
  ConfigGenerator: {
    generate: vi.fn(() => ({ outbound: {} })),
  },
}));

describe('XrayService', () => {
  const mockConfig = makeServer({
    uuid: 'uuid',
    address: 'addr',
    name: 'test',
    security: 'reality',
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.existsSync).mockReturnValue(true);
  });

  it('writes generated config and spawns Xray with the config path', async () => {
    const svc = new XrayService();
    const mockProcess = createMockChildProcess();
    vi.mocked(spawn).mockReturnValue(mockProcess as any);

    await svc.start(mockConfig);

    expect(ConfigGenerator.generate).toHaveBeenCalledWith(
      mockConfig,
      expect.stringMatching(/[\\/]tmp[\\/]xray\.log$/),
      'proxy',
      {}
    );
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.stringMatching(/[\\/]tmp[\\/]config\.json$/),
      JSON.stringify({ outbound: {} }, null, 2)
    );
    expect(spawn).toHaveBeenCalledWith(
      expect.stringMatching(/resources[\\/]+bin[\\/]+xray(\.exe)?$/),
      ['-c', expect.stringMatching(/[\\/]tmp[\\/]config\.json$/)],
      expect.objectContaining({
        env: expect.objectContaining({
          XRAY_LOCATION_ASSET: expect.stringMatching(/resources[\\/]+bin$/),
        }),
      })
    );
    expect(svc.isRunning()).toBe(true);
  });

  it('throws when the Xray binary is missing', async () => {
    const svc = new XrayService();
    vi.mocked(fs.existsSync).mockReturnValue(false);

    await expect(svc.start(mockConfig)).rejects.toThrow('Xray binary not found');
  });

  it('stops the running child process on demand', async () => {
    const svc = new XrayService();
    const mockProcess = createMockChildProcess();
    vi.mocked(spawn).mockReturnValue(mockProcess as any);

    await svc.start(mockConfig);
    svc.stop();

    expect(mockProcess.kill).toHaveBeenCalledTimes(1);
    expect(svc.isRunning()).toBe(false);
  });

  it('emits unexpected-exit when the child process closes unexpectedly', async () => {
    const svc = new XrayService();
    const mockProcess = createMockChildProcess();
    vi.mocked(spawn).mockReturnValue(mockProcess as any);

    const onUnexpectedExit = vi.fn();
    svc.on('unexpected-exit', onUnexpectedExit);

    await svc.start(mockConfig);
    mockProcess.emit('close', 17);

    expect(onUnexpectedExit).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 17,
        signal: null,
        config: mockConfig,
      })
    );
    expect(svc.isRunning()).toBe(false);
  });

  it('does not emit unexpected-exit for an expected stop', async () => {
    const svc = new XrayService();
    const mockProcess = createMockChildProcess();
    vi.mocked(spawn).mockReturnValue(mockProcess as any);

    const onUnexpectedExit = vi.fn();
    svc.on('unexpected-exit', onUnexpectedExit);

    await svc.start(mockConfig);
    svc.stop();
    mockProcess.emit('close', 0);

    expect(onUnexpectedExit).not.toHaveBeenCalled();
  });
});
