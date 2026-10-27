/**
 * The part of Node's `events` the main-process modules use. Listeners run
 * synchronously in registration order, as in Node; `error` without a
 * listener throws.
 */
// Listeners take whatever their event carries, as with Node's emitter.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Listener = (...args: any[]) => void;

interface Registration {
  listener: Listener;
  once: boolean;
}

export class EventEmitter {
  static defaultMaxListeners = 10;
  private readonly registrations = new Map<string | symbol, Registration[]>();

  private add(
    event: string | symbol,
    listener: Listener,
    once: boolean,
    prepend = false,
  ): this {
    const list = this.registrations.get(event) ?? [];
    const entry = { listener, once };
    if (prepend) list.unshift(entry);
    else list.push(entry);
    this.registrations.set(event, list);
    return this;
  }

  on(event: string | symbol, listener: Listener): this {
    return this.add(event, listener, false);
  }

  addListener(event: string | symbol, listener: Listener): this {
    return this.add(event, listener, false);
  }

  prependListener(event: string | symbol, listener: Listener): this {
    return this.add(event, listener, false, true);
  }

  once(event: string | symbol, listener: Listener): this {
    return this.add(event, listener, true);
  }

  off(event: string | symbol, listener: Listener): this {
    return this.removeListener(event, listener);
  }

  removeListener(event: string | symbol, listener: Listener): this {
    const list = this.registrations.get(event);
    if (!list) return this;
    const index = list.findIndex((entry) => entry.listener === listener);
    if (index !== -1) list.splice(index, 1);
    if (list.length === 0) this.registrations.delete(event);
    return this;
  }

  removeAllListeners(event?: string | symbol): this {
    if (event === undefined) this.registrations.clear();
    else this.registrations.delete(event);
    return this;
  }

  emit(event: string | symbol, ...args: unknown[]): boolean {
    const list = this.registrations.get(event);
    if (!list || list.length === 0) {
      if (event === 'error') {
        throw args[0] instanceof Error
          ? args[0]
          : new Error(`Unhandled error event: ${String(args[0])}`);
      }
      return false;
    }
    for (const entry of [...list]) {
      if (entry.once) this.removeListener(event, entry.listener);
      entry.listener.apply(this, args);
    }
    return true;
  }

  listenerCount(event: string | symbol): number {
    return this.registrations.get(event)?.length ?? 0;
  }

  listeners(event: string | symbol): Listener[] {
    return (this.registrations.get(event) ?? []).map((entry) => entry.listener);
  }

  eventNames(): (string | symbol)[] {
    return [...this.registrations.keys()];
  }

  setMaxListeners(): this {
    return this;
  }

  getMaxListeners(): number {
    return EventEmitter.defaultMaxListeners;
  }
}

export default EventEmitter;
