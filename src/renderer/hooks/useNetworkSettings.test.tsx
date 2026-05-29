/* @vitest-environment jsdom */
import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AppSnapshotProvider } from './useAppSnapshot';
import { useNetworkSettings } from './useNetworkSettings';
import {
  createElectronApiMock,
  installElectronApiMock,
} from '@/test/electronApiMock';
import { makeAppSnapshot } from '@/test/factories';

describe('useNetworkSettings', () => {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <AppSnapshotProvider>{children}</AppSnapshotProvider>
  );

  it('uses connection mode from the app snapshot as the source of truth', async () => {
    const electronApi = createElectronApiMock();
    electronApi.getAppSnapshot.mockResolvedValue(
      makeAppSnapshot({ connectionMode: 'tun' }),
    );
    installElectronApiMock(electronApi);

    const { result } = renderHook(() => useNetworkSettings(true), { wrapper });

    await waitFor(() => expect(result.current.connectionMode).toBe('tun'));
  });

  it('loads performance settings and TUN capability when settings are open', async () => {
    const electronApi = createElectronApiMock();
    electronApi.getPerformanceSettings.mockResolvedValue({
      muxEnabled: true,
      muxConcurrency: 4,
      xudpConcurrency: 16,
      xudpProxyUDP443: 'reject',
      tcpFastOpen: true,
      sniffingRouteOnly: true,
      logLevel: 'warning',
      fingerprint: 'chrome',
      blockAds: false,
      blockBittorrent: false,
      domainStrategy: 'AsIs',
    });
    installElectronApiMock(electronApi);

    const { result } = renderHook(() => useNetworkSettings(true), { wrapper });

    await waitFor(() => expect(result.current.perfSettings.muxEnabled).toBe(true));
    expect(electronApi.getTunCapabilityStatus).toHaveBeenCalled();
  });
});
