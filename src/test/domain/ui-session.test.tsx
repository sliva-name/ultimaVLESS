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

  it('highlights the clicked row when two catalog servers share a uuid', async () => {
    const serverA = makeServer({
      uuid: 'dup',
      name: 'Germany',
      sni: 'de.example',
    });
    const serverB = makeServer({
      uuid: 'dup',
      name: 'Netherlands',
      sni: 'nl.example',
    });
    const electronApi = createElectronApiMock();
    electronApi.getAppSnapshot.mockResolvedValue(
      makeAppSnapshot({
        servers: [serverA, serverB],
        selectedServerId: serverA.uuid,
      }),
    );
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
      expect(result.current.selectedServer?.name).toBe('Germany'),
    );

    act(() => {
      result.current.selectServer(serverB);
    });
    expect(result.current.selectedServer?.name).toBe('Netherlands');

    act(() => {
      electronApi.emitAppSnapshotChanged(
        makeAppSnapshot({
          servers: [serverA, serverB],
          selectedServerId: serverA.uuid,
        }),
      );
    });
    expect(result.current.selectedServer?.name).toBe('Netherlands');

    await act(async () => {
      resolvePersist(true);
    });
    await waitFor(() =>
      expect(result.current.selectedServer?.name).toBe('Netherlands'),
    );
  });

  it('lets the user pick another server after a failed connect', async () => {
    const serverA = makeServer({ uuid: 'server-a' });
    const serverB = makeServer({ uuid: 'server-b' });
    const failedSnapshot = makeAppSnapshot({
      servers: [serverA, serverB],
      selectedServerId: serverA.uuid,
      session: {
        phase: 'failed',
        activeServerId: null,
        lastError:
          'VLESS requires TLS/REALITY (or VLESS Encryption) for public server addresses',
        blockedServerIds: [],
      },
    });
    const electronApi = createElectronApiMock();
    electronApi.getAppSnapshot.mockResolvedValue(failedSnapshot);
    installElectronApiMock(electronApi);

    const { result } = renderHook(() => useAppSnapshotContext(), { wrapper });
    await waitFor(() => {
      expect(result.current.snapshot.session.phase).toBe('failed');
      expect(result.current.selectedServer?.uuid).toBe(serverA.uuid);
    });

    act(() => {
      result.current.selectServer(serverB);
    });

    expect(result.current.selectedServer?.uuid).toBe(serverB.uuid);
    await waitFor(() =>
      expect(electronApi.setSelectedServerId).toHaveBeenCalledWith(serverB.uuid),
    );
  });

  it('connects the newly selected server after a failed session', async () => {
    const serverA = makeServer({ uuid: 'bad-server' });
    const serverB = makeServer({ uuid: 'good-server' });
    const electronApi = createElectronApiMock();
    electronApi.getAppSnapshot.mockResolvedValue(
      makeAppSnapshot({
        servers: [serverA, serverB],
        selectedServerId: serverA.uuid,
        session: {
          phase: 'failed',
          activeServerId: null,
          lastError: 'Config generation failed: VLESS requires TLS/REALITY',
          blockedServerIds: [],
        },
      }),
    );
    installElectronApiMock(electronApi);

    const { result } = renderHook(() => useAppSnapshotContext(), { wrapper });
    await waitFor(() =>
      expect(result.current.snapshot.session.phase).toBe('failed'),
    );

    electronApi.getAppSnapshot.mockResolvedValue(
      makeAppSnapshot({
        servers: [serverA, serverB],
        selectedServerId: serverB.uuid,
        session: {
          phase: 'failed',
          activeServerId: null,
          lastError: 'Config generation failed: VLESS requires TLS/REALITY',
          blockedServerIds: [],
        },
      }),
    );

    act(() => {
      result.current.selectServer(serverB);
    });
    await waitFor(() =>
      expect(result.current.selectedServer?.uuid).toBe(serverB.uuid),
    );

    await act(async () => {
      await result.current.toggleConnection();
    });

    expect(electronApi.connect).toHaveBeenCalledWith(serverB.uuid);
  });

  it('ignores server clicks while a connect is in flight', async () => {
    const serverA = makeServer({ uuid: 'server-a' });
    const serverB = makeServer({ uuid: 'server-b' });
    const electronApi = createElectronApiMock();
    electronApi.getAppSnapshot.mockResolvedValue(
      makeAppSnapshot({
        servers: [serverA, serverB],
        selectedServerId: serverA.uuid,
        session: {
          phase: 'connecting',
          activeServerId: serverA.uuid,
          lastError: null,
          blockedServerIds: [],
        },
      }),
    );
    installElectronApiMock(electronApi);

    const { result } = renderHook(() => useAppSnapshotContext(), { wrapper });
    await waitFor(() =>
      expect(result.current.snapshot.session.phase).toBe('connecting'),
    );

    act(() => {
      result.current.selectServer(serverB);
    });

    expect(electronApi.setSelectedServerId).not.toHaveBeenCalled();
    expect(result.current.selectedServer?.uuid).toBe(serverA.uuid);
  });
});
