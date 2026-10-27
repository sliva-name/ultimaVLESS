import { EventEmitter } from './events';
import { ipVersion, parseIpv4, parseIpv6 } from './ipAddress';
import { UltimaCore } from '../native/UltimaCore';

/**
 * Node's `net` as used by the probes: `isIP`, `BlockList`, and TCP sockets
 * that only connect (the probes never write). The connect runs natively.
 */

export function isIP(input: string): 0 | 4 | 6 {
  return ipVersion(input);
}

export function isIPv4(input: string): boolean {
  return ipVersion(input) === 4;
}

export function isIPv6(input: string): boolean {
  return ipVersion(input) === 6;
}

type IpFamily = 'ipv4' | 'ipv6';

interface Subnet {
  family: IpFamily;
  network: bigint;
  prefix: number;
}

const IPV4_MAPPED_PREFIX = 0xffffn << 32n;

function toBigInt(address: string, family: IpFamily): bigint | null {
  if (family === 'ipv4') {
    const v4 = parseIpv4(address);
    return v4 === null ? null : BigInt(v4);
  }
  return parseIpv6(address);
}

function mask(value: bigint, prefix: number, bits: number): bigint {
  const hostBits = BigInt(bits - prefix);
  return (value >> hostBits) << hostBits;
}

export class BlockList {
  private readonly subnets: Subnet[] = [];

  addSubnet(address: string, prefix: number, type: IpFamily = 'ipv4'): void {
    const value = toBigInt(address, type);
    if (value === null) throw new TypeError(`Invalid address: ${address}`);
    const bits = type === 'ipv4' ? 32 : 128;
    this.subnets.push({
      family: type,
      network: mask(value, prefix, bits),
      prefix,
    });
  }

  addAddress(address: string, type: IpFamily = 'ipv4'): void {
    this.addSubnet(address, type === 'ipv4' ? 32 : 128, type);
  }

  /** Like Node, an IPv4-mapped IPv6 address also matches the IPv4 subnets. */
  check(address: string, type: IpFamily = 'ipv4'): boolean {
    const value = toBigInt(address, type);
    if (value === null) return false;
    const mappedV4 =
      type === 'ipv6' && value >> 32n === 0xffffn
        ? value - IPV4_MAPPED_PREFIX
        : null;
    return this.subnets.some((subnet) => {
      if (subnet.family === type) {
        const bits = type === 'ipv4' ? 32 : 128;
        return mask(value, subnet.prefix, bits) === subnet.network;
      }
      if (subnet.family === 'ipv4' && mappedV4 !== null) {
        return mask(mappedV4, subnet.prefix, 32) === subnet.network;
      }
      return false;
    });
  }
}

interface ConnectOptions {
  host?: string;
  port: number;
  localAddress?: string;
}

/**
 * Emits `connect`, `timeout` or `error`, then `close`. A socket that times
 * out stays open until destroyed, as in Node.
 */
export class Socket extends EventEmitter {
  private timeoutMs = 0;
  private timeoutTimer: ReturnType<typeof setTimeout> | null = null;
  destroyed = false;

  setTimeout(ms: number): this {
    this.timeoutMs = ms;
    return this;
  }

  connect(portOrOptions: number | ConnectOptions, host?: string): this {
    const options =
      typeof portOrOptions === 'number'
        ? { port: portOrOptions, host }
        : portOrOptions;
    // Let the caller attach listeners first, as with Node's async connect.
    queueMicrotask(() => this.start(options.host ?? '127.0.0.1', options.port));
    return this;
  }

  private start(host: string, port: number): void {
    if (this.destroyed) return;
    if (this.timeoutMs > 0) {
      this.timeoutTimer = setTimeout(() => {
        this.timeoutTimer = null;
        if (!this.destroyed) this.emit('timeout');
      }, this.timeoutMs);
    }
    // The native connect needs its own bound; the timeout event above is
    // what the caller acts on.
    const nativeTimeout = this.timeoutMs > 0 ? this.timeoutMs + 1000 : 30_000;
    UltimaCore.tcpConnect({ host, port, timeoutMs: nativeTimeout }).then(
      (result) => {
        if (this.destroyed) return;
        this.clearTimer();
        if (result.ok) {
          this.emit('connect');
        } else {
          this.emit('error', new Error(result.error ?? 'connect failed'));
          this.destroy();
        }
      },
      (error: unknown) => {
        if (this.destroyed) return;
        this.clearTimer();
        this.emit(
          'error',
          error instanceof Error ? error : new Error(String(error)),
        );
        this.destroy();
      },
    );
  }

  private clearTimer(): void {
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = null;
    }
  }

  destroy(): this {
    if (this.destroyed) return this;
    this.destroyed = true;
    this.clearTimer();
    queueMicrotask(() => this.emit('close', false));
    return this;
  }

  end(): this {
    return this.destroy();
  }

  unref(): this {
    return this;
  }
}

export function createConnection(options: ConnectOptions): Socket {
  return new Socket().connect(options);
}

export const connect = createConnection;

export function createServer(): never {
  throw new Error('Listening sockets are not available on Android');
}

export default {
  isIP,
  isIPv4,
  isIPv6,
  BlockList,
  Socket,
  createConnection,
  connect,
  createServer,
};
