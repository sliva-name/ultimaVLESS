import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VlessConfig } from '../../shared/types';
import fs from 'fs';
import { spawn } from 'child_process';
// Import statically to ensure same mock reference
import { XrayService } from './XrayService';

// Mock fs module
vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(() => true),
    writeFileSync: vi.fn(),
    appendFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    chmodSync: vi.fn(),
  }
}));

// Mock child_process
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
    isPackaged: false
  }
}));

// Mock ConfigGenerator
vi.mock('./ConfigGenerator', () => ({
  ConfigGenerator: {
    generate: vi.fn(() => ({ outbound: {} }))
  }
}));

describe('XrayService', () => {
  const mockConfig: VlessConfig = {
    uuid: 'uuid',
    address: 'addr',
    port: 443,
    name: 'test',
    security: 'reality'
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should start xray process if binary exists', async () => {
    const svc = new XrayService();

    // Setup mocks
    vi.mocked(fs.writeFileSync).mockReturnValue(undefined);
    vi.mocked(fs.existsSync).mockReturnValue(true);
    
    const mockProcess = {
      pid: 123,
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn(),
      once: vi.fn(),
      kill: vi.fn()
    };
    vi.mocked(spawn).mockReturnValue(mockProcess as any);

    await svc.start(mockConfig);

    expect(fs.writeFileSync).toHaveBeenCalled();
    expect(spawn).toHaveBeenCalled();
    expect(svc.isRunning()).toBe(true);
  });

  it('should throw if binary missing', async () => {
    const svc = new XrayService();

    vi.mocked(fs.writeFileSync).mockReturnValue(undefined);
    vi.mocked(fs.existsSync).mockReturnValue(false);

    await expect(svc.start(mockConfig)).rejects.toThrow('Xray binary not found');
  });

  it('should stop process when requested', async () => {
    const svc = new XrayService();

    vi.mocked(fs.writeFileSync).mockReturnValue(undefined);
    vi.mocked(fs.existsSync).mockReturnValue(true);
    const mockProcess = {
      pid: 123,
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn(),
      kill: vi.fn(() => true)
    };
    vi.mocked(spawn).mockReturnValue(mockProcess as any);

    await svc.start(mockConfig);
    expect(svc.isRunning()).toBe(true);

    svc.stop();
    expect(mockProcess.kill).toHaveBeenCalled();
    expect(svc.isRunning()).toBe(false);
  });

  it('emits unexpected-exit when process closes unexpectedly', async () => {
    const svc = new XrayService();

    vi.mocked(fs.writeFileSync).mockReturnValue(undefined);
    vi.mocked(fs.existsSync).mockReturnValue(true);

    const listeners: Record<string, ((...args: any[]) => void)[]> = {};
    const mockProcess = {
      pid: 123,
      signalCode: null,
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn((event: string, listener: (...args: any[]) => void) => {
        listeners[event] ??= [];
        listeners[event].push(listener);
      }),
      once: vi.fn(),
      kill: vi.fn(),
    };
    vi.mocked(spawn).mockReturnValue(mockProcess as any);

    const onUnexpectedExit = vi.fn();
    svc.on('unexpected-exit', onUnexpectedExit);

    await svc.start(mockConfig);
    listeners.close?.[0]?.(17);

    expect(onUnexpectedExit).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 17,
        signal: null,
        config: mockConfig,
      })
    );
    expect(svc.isRunning()).toBe(false);
  });
});
