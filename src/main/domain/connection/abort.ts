export class ConnectionOperationAbortedError extends Error {
  constructor(message = 'Connection operation aborted') {
    super(message);
    this.name = 'ConnectionOperationAbortedError';
  }
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new ConnectionOperationAbortedError();
  }
}

export function isConnectionOperationCancelled(error: unknown): boolean {
  return error instanceof ConnectionOperationAbortedError;
}
