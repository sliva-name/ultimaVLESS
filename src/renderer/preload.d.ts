import type { IElectronAPI } from '@/shared/contracts/preloadApi';

export type { IElectronAPI };

declare global {
  interface Window {
    electronAPI: IElectronAPI;
  }
}
