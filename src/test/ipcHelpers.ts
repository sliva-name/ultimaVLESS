import { vi } from 'vitest';

export type CapturedIpcHandler = (
  event: unknown,
  payload?: unknown,
) => Promise<unknown> | unknown;

export function captureIpcHandlers(ipcHandleMock: ReturnType<typeof vi.fn>) {
  const handlers = new Map<string, CapturedIpcHandler>();
  ipcHandleMock.mockImplementation(
    (channel: string, handler: CapturedIpcHandler) => {
      handlers.set(channel, handler);
    },
  );
  return handlers;
}
