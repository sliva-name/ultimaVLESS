/* @vitest-environment jsdom */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useServerState } from './useServerState';
import { createElectronApiMock, installElectronApiMock } from '../../test/electronApiMock';
import { makeMonitorStatus, makeServer, makeSubscriptionPayload } from '../../test/factories';

describe('useServerState.saveSubscription', () => {
  beforeEach(() => {
    installElectronApiMock(createElectronApiMock());
  });

  it('returns error result when electronAPI.saveSubscription resolves false', async () => {
    const electronApi = createElectronApiMock();
    installElectronApiMock(electronApi);
    electronApi.saveSubscription.mockResolvedValue(false);

    const { result } = renderHook(() => useServerState());
    await waitFor(() => expect(electronApi.getServers).toHaveBeenCalled());

    let saveResult: { ok: boolean; error?: string } | undefined;
    await act(async () => {
      saveResult = await result.current.saveSubscription(makeSubscriptionPayload());
    });

    expect(saveResult).toEqual({
      ok: false,
      error: 'Failed to save subscription',
    });
    expect(result.current.isConfigLoading).toBe(false);
  });

  it('returns thrown error messages from electronAPI.saveSubscription', async () => {
    const electronApi = createElectronApiMock();
    installElectronApiMock(electronApi);
    electronApi.saveSubscription.mockRejectedValue(new Error('Subscription endpoint failed'));
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { result } = renderHook(() => useServerState());
    await waitFor(() => expect(electronApi.getServers).toHaveBeenCalled());

    let saveResult: { ok: boolean; error?: string } | undefined;
    await act(async () => {
      saveResult = await result.current.saveSubscription(makeSubscriptionPayload());
    });

    expect(saveResult).toEqual({
      ok: false,
      error: 'Subscription endpoint failed',
    });
    consoleErrorSpy.mockRestore();
  });
});

describe('useServerState', () => {
  it('loads the saved selected server during initial state fetch', async () => {
    const electronApi = createElectronApiMock();
    const savedServer = makeServer({ uuid: 'active-server', name: 'Active Server', ping: 42, pingTime: 1 });
    electronApi.getServers.mockResolvedValue([savedServer]);
    electronApi.getSelectedServerId.mockResolvedValue(savedServer.uuid);
    installElectronApiMock(electronApi);

    const { result } = renderHook(() => useServerState());
    await waitFor(() => expect(result.current.selectedServer?.uuid).toBe(savedServer.uuid));
  });

  it('keeps the live connected server selected after server list refresh removes it', async () => {
    const currentServer = makeServer({ uuid: 'active-server', name: 'Active Server', ping: 42, pingTime: 1 });
    const refreshedServer = makeServer({ uuid: 'new-server', name: 'New Server', ping: 18, pingTime: 1 });
    const electronApi = createElectronApiMock();
    electronApi.getServers.mockResolvedValue([currentServer]);
    electronApi.getSelectedServerId.mockResolvedValue(currentServer.uuid);
    electronApi.getConnectionStatus.mockResolvedValue(true);
    electronApi.getConnectionMonitorStatus.mockResolvedValue(
      makeMonitorStatus({
        isConnected: true,
        currentServer,
      })
    );
    installElectronApiMock(electronApi);

    const { result } = renderHook(() => useServerState());
    await waitFor(() => expect(result.current.selectedServer?.uuid).toBe(currentServer.uuid));

    await act(async () => {
      electronApi.emitUpdateServers([refreshedServer]);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.selectedServer?.uuid).toBe(currentServer.uuid);
      expect(result.current.selectedServer?.name).toBe(currentServer.name);
    });
  });

  it('connects the selected server when toggled while disconnected', async () => {
    const selectedServer = makeServer({ uuid: 'server-to-connect', ping: 42, pingTime: 1 });
    const electronApi = createElectronApiMock();
    electronApi.getServers.mockResolvedValue([selectedServer]);
    electronApi.getSelectedServerId.mockResolvedValue(selectedServer.uuid);
    installElectronApiMock(electronApi);

    const { result } = renderHook(() => useServerState());
    await waitFor(() => expect(result.current.selectedServer?.uuid).toBe(selectedServer.uuid));

    await act(async () => {
      await result.current.toggleConnection();
    });

    expect(electronApi.connect).toHaveBeenCalledWith(selectedServer);
    expect(electronApi.disconnect).not.toHaveBeenCalled();
  });

  it('disconnects when toggled while already connected', async () => {
    const selectedServer = makeServer({ uuid: 'server-to-disconnect', ping: 42, pingTime: 1 });
    const electronApi = createElectronApiMock();
    electronApi.getServers.mockResolvedValue([selectedServer]);
    electronApi.getSelectedServerId.mockResolvedValue(selectedServer.uuid);
    electronApi.getConnectionStatus.mockResolvedValue(true);
    installElectronApiMock(electronApi);

    const { result } = renderHook(() => useServerState());
    await waitFor(() => expect(result.current.selectedServer?.uuid).toBe(selectedServer.uuid));

    await act(async () => {
      await result.current.toggleConnection();
    });

    expect(electronApi.disconnect).toHaveBeenCalledTimes(1);
    expect(electronApi.connect).not.toHaveBeenCalled();
  });
});
