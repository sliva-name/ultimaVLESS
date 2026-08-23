/* @vitest-environment jsdom */
import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  AppSnapshotProvider,
  useAppSnapshotContext,
  useServers,
  useSession,
} from '@/renderer/hooks/useAppSnapshot';
import {
  createElectronApiMock,
  installElectronApiMock,
} from '@/test/electronApiMock';
import { makeAppSnapshot, makeServer } from '@/test/factories';

describe('renderer session view', () => {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <AppSnapshotProvider>{children}</AppSnapshotProvider>
  );

  it('hydrates selection from the snapshot', async () => {
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

  it('maps session.phase to connected/busy 1:1', async () => {
    const electronApi = createElectronApiMock();
    installElectronApiMock(electronApi);
    const { result } = renderHook(() => useSession(), { wrapper });

    act(() => {
      electronApi.emitAppSnapshotChanged(
        makeAppSnapshot({
          session: {
            phase: 'connected',
            activeServerId: 'server-1',
            lastError: null,
            blockedServerIds: [],
          },
        }),
      );
    });
    await waitFor(() => {
      expect(result.current.isConnected).toBe(true);
      expect(result.current.isConnectionBusy).toBe(false);
    });

    act(() => {
      electronApi.emitAppSnapshotChanged(
        makeAppSnapshot({
          session: {
            phase: 'disconnecting',
            activeServerId: null,
            lastError: null,
            blockedServerIds: [],
          },
        }),
      );
    });
    await waitFor(() => {
      expect(result.current.session.phase).toBe('disconnecting');
      expect(result.current.isConnected).toBe(false);
      expect(result.current.isConnectionBusy).toBe(true);
    });
  });

  it('starts a connect for the selected server when idle', async () => {
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

  it('keeps optimistic selection until the snapshot confirms the new id', async () => {
    const serverA = makeServer({ uuid: 'server-a' });
    const serverB = makeServer({ uuid: 'server-b' });
    const snapshotWithA = makeAppSnapshot({
      servers: [serverA, serverB],
      selectedServerId: serverA.uuid,
    });
    const electronApi = createElectronApiMock();
    electronApi.getAppSnapshot.mockResolvedValue(snapshotWithA);
    let resolvePersist: (value: boolean) => void = () => undefined;
    electronApi.setSelectedServerId.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          resolvePersist = resolve;
        }),
    );
    installElectronApiMock(electronApi);

    const { result } = renderHook(() => useAppSnapshotContext(), { wrapper });
    await waitFor(() =>
      expect(result.current.selectedServer?.uuid).toBe(serverA.uuid),
    );

    act(() => {
      result.current.selectServer(serverB);
    });
    expect(result.current.selectedServer?.uuid).toBe(serverB.uuid);

    act(() => {
      electronApi.emitAppSnapshotChanged(snapshotWithA);
    });
    expect(result.current.selectedServer?.uuid).toBe(serverB.uuid);

    electronApi.getAppSnapshot.mockResolvedValue(
      makeAppSnapshot({
        servers: [serverA, serverB],
        selectedServerId: serverB.uuid,
      }),
    );
    await act(async () => {
      resolvePersist(true);
    });
    await waitFor(() =>
      expect(result.current.selectedServer?.uuid).toBe(serverB.uuid),
    );
  });

  it('rolls back optimistic selection when persistence fails', async () => {
    const serverA = makeServer({ uuid: 'server-a' });
    const serverB = makeServer({ uuid: 'server-b' });
    const electronApi = createElectronApiMock();
    electronApi.getAppSnapshot.mockResolvedValue(
      makeAppSnapshot({
        servers: [serverA, serverB],
        selectedServerId: serverA.uuid,
      }),
    );
    electronApi.setSelectedServerId.mockRejectedValue(new Error('boom'));
    installElectronApiMock(electronApi);

    const { result } = renderHook(() => useAppSnapshotContext(), { wrapper });
    await waitFor(() =>
      expect(result.current.selectedServer?.uuid).toBe(serverA.uuid),
    );

    act(() => {
      result.current.selectServer(serverB);
    });
    expect(result.current.selectedServer?.uuid).toBe(serverB.uuid);

    await waitFor(() =>
      expect(result.current.selectedServer?.uuid).toBe(serverA.uuid),
    );
    expect(result.current.connectionError).toBe(
      'Failed to persist selected server',
    );
  });
});
