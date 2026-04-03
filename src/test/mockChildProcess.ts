import { EventEmitter } from 'events';
import { vi } from 'vitest';

export interface MockChildProcess extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
  pid: number;
  signalCode: NodeJS.Signals | null;
}

export function createMockChildProcess(): MockChildProcess {
  const child = new EventEmitter() as MockChildProcess;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn(() => true);
  child.pid = 1234;
  child.signalCode = null;
  return child;
}
