export interface SerialQueue {
  enqueue<T>(job: () => Promise<T>): Promise<T>;
}

export function createSerialQueue(): SerialQueue {
  let queue: Promise<unknown> = Promise.resolve();

  return {
    enqueue<T>(job: () => Promise<T>): Promise<T> {
      const run = async (): Promise<T> => job();
      const operation = queue.then(run, run);
      queue = operation.then(
        () => undefined,
        () => undefined,
      );
      return operation;
    },
  };
}
