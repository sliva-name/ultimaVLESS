export interface SerialQueue {
  enqueue<T>(job: () => Promise<T>): Promise<T>;
}

export function createSerialQueue(): SerialQueue {
  let queue: Promise<unknown> = Promise.resolve();

  return {
    enqueue<T>(job: () => Promise<T>): Promise<T> {
      const operation = queue.then(job, job);
      queue = operation.then(
        () => undefined,
        () => undefined,
      );
      return operation;
    },
  };
}
