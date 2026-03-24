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
    mkdirSync: vi.fn(),
    promises: {
      writeFile: vi.fn(),
      access: vi.fn(),
    },
    constants: {
      X_OK: 1,
    },
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
    vi.mocked(fs.promises.writeFile).mockResolvedValue(undefined as never);
    vi.mocked(fs.promises.access).mockResolvedValue(undefined as never);
    
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

    expect(fs.promises.writeFile).toHaveBeenCalled();
    expect(spawn).toHaveBeenCalled();
    expect(svc.isRunning()).toBe(true);
  });

  it('should throw if binary missing', async () => {
    const svc = new XrayService();

    vi.mocked(fs.promises.writeFile).mockResolvedValue(undefined as never);
    vi.mocked(fs.promises.access).mockRejectedValue(new Error('missing') as never);

    await expect(svc.start(mockConfig)).rejects.toThrow('Xray binary not found');
  });

  it('should stop process when requested', async () => {
    const svc = new XrayService();

    vi.mocked(fs.promises.writeFile).mockResolvedValue(undefined as never);
    vi.mocked(fs.promises.access).mockResolvedValue(undefined as never);
    const mockProcess = {
      pid: 123,
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn(),
      once: vi.fn((event: string, callback: () => void) => {
        if (event === 'close') {
          callback();
        }
      }),
      kill: vi.fn(() => true)
    };
    vi.mocked(spawn).mockReturnValue(mockProcess as any);

    await svc.start(mockConfig);
    expect(svc.isRunning()).toBe(true);

    await svc.stop();
    expect(mockProcess.kill).toHaveBeenCalled();
    expect(svc.isRunning()).toBe(false);
  });
});
