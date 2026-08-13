import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Mock Electron modules
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp'),
    isPackaged: false,
  },
  ipcMain: {
    on: vi.fn(),
    handle: vi.fn(),
  },
  BrowserWindow: vi.fn().mockImplementation(() => ({
    loadURL: vi.fn(),
    loadFile: vi.fn(),
    webContents: {
      openDevTools: vi.fn(),
      send: vi.fn(),
    },
  })),
}));

// Mock electron-store
vi.mock('electron-store', () => {
  class MockStore {
    get = vi.fn();
    set = vi.fn();
    delete = vi.fn();
    path = '/tmp/app-config.json';
  }
  return { default: MockStore };
});
