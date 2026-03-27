import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useServerState } from './useServerState';

type ElectronApiMock = {
  getServers: ReturnType<typeof vi.fn>;
  getSelectedServerId: ReturnType<typeof vi.fn>;
  getConnectionStatus: ReturnType<typeof vi.fn>;
  getConnectionBusy: ReturnType<typeof vi.fn>;
  onUpdateServers: ReturnType<typeof vi.fn>;
  onConnectionStatus: ReturnType<typeof vi.fn>;
  onConnectionBusy: ReturnType<typeof vi.fn>;
  onConnectionError: ReturnType<typeof vi.fn>;
  saveSubscription: ReturnType<typeof vi.fn>;
  pingAllServers: ReturnType<typeof vi.fn>;
  setSelectedServerId: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
};

function createElectronApiMock(): ElectronApiMock {
  return {
    getServers: vi.fn().mockResolvedValue([]),
    getSelectedServerId: vi.fn().mockResolvedValue(null),
    getConnectionStatus: vi.fn().mockResolvedValue(false),
    getConnectionBusy: vi.fn().mockResolvedValue(false),
    onUpdateServers: vi.fn().mockImplementation(() => vi.fn()),
    onConnectionStatus: vi.fn().mockImplementation(() => vi.fn()),
    onConnectionBusy: vi.fn().mockImplementation(() => vi.fn()),
    onConnectionError: vi.fn().mockImplementation(() => vi.fn()),
    saveSubscription: vi.fn().mockResolvedValue(true),
    pingAllServers: vi.fn().mockResolvedValue([]),
    setSelectedServerId: vi.fn().mockResolvedValue(true),
    connect: vi.fn().mockResolvedValue({ ok: true }),
    disconnect: vi.fn().mockResolvedValue({ ok: true }),
  };
}

describe('useServerState.saveSubscription', () => {
  beforeEach(() => {
    (window as unknown as { electronAPI: ElectronApiMock }).electronAPI = createElectronApiMock();
  });

  it('returns error result when electronAPI.saveSubscription resolves false', async () => {
    const electronApi = (window as unknown as { electronAPI: ElectronApiMock }).electronAPI;
    electronApi.saveSubscription.mockResolvedValue(false);

    const { result } = renderHook(() => useServerState());
    await waitFor(() => expect(electronApi.getServers).toHaveBeenCalled());

    let saveResult: { ok: boolean; error?: string } | undefined;
    await act(async () => {
      saveResult = await result.current.saveSubscription({
        subscriptionUrl: 'https://example.com/sub',
        manualLinks: '',
      });
    });

    expect(saveResult).toEqual({
      ok: false,
      error: 'Failed to save subscription',
    });
    expect(result.current.isConfigLoading).toBe(false);
  });
});
