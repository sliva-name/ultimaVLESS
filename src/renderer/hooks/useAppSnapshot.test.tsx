/* @vitest-environment jsdom */
import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  AppSnapshotProvider,
  useAppSnapshotContext,
  useServers,
  useSession,
} from './useAppSnapshot';
import {
  createElectronApiMock,
  installElectronApiMock,
} from '@/test/electronApiMock';
import { makeAppSnapshot, makeServer } from '@/test/factories';

describe('AppSnapshotProvider', () => {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <AppSnapshotProvider>{children}</AppSnapshotProvider>
  );

  it('hydrates server selectors from the initial snapshot', async () => {
    const server = makeServer({ uuid: 'selected' });
    const electronApi = createElectronApiMock();
    electronApi.getAppSnapshot.mockResolvedValue(
      makeAppSnapshot({
        servers: [server],
        selectedServerId: server.uuid,
      }),
    );
    installElectronApiMock(electronApi);

    const { result } = renderHook(() => useServers(), { wrapper });

    await waitFor(() =>
      expect(result.current.selectedServer?.uuid).toBe(server.uuid),
    );
  });

  it('routes connection toggles through command APIs', async () => {
    const server = makeServer({ uuid: 'server-to-connect' });
    const electronApi = createElectronApiMock();
    electronApi.getAppSnapshot.mockResolvedValue(
      makeAppSnapshot({
        servers: [server],
        selectedServerId: server.uuid,
      }),
    );
    installElectronApiMock(electronApi);

    const { result } = renderHook(() => useAppSnapshotContext(), { wrapper });
    await waitFor(() =>
      expect(result.current.selectedServer?.uuid).toBe(server.uuid),
    );

    await act(async () => {
      await result.current.toggleConnection();
    });

    expect(electronApi.connect).toHaveBeenCalledWith(server.uuid);
  });

  it('updates consumers from app-snapshot-changed events', async () => {
    const electronApi = createElectronApiMock();
    installElectronApiMock(electronApi);
    const { result } = renderHook(() => useSession(), { wrapper });

    act(() => {
      electronApi.emitAppSnapshotChanged(
        makeAppSnapshot({
          session: {
            status: 'connected',
            busy: false,
            activeServerId: 'server-1',
            lastError: null,
            blockedServerIds: [],
          },
        }),
      );
    });

    await waitFor(() => expect(result.current.isConnected).toBe(true));
  });
});
