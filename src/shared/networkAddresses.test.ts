import { describe, expect, it } from 'vitest';
import {
  isValidIpOrCidr,
  isValidIpv4Address,
  isValidIpv6Address,
} from './networkAddresses';

describe('isValidIpv4Address', () => {
  it('accepts dotted quads and rejects junk', () => {
    expect(isValidIpv4Address('1.1.1.1')).toBe(true);
    expect(isValidIpv4Address('0.0.0.0')).toBe(true);
    expect(isValidIpv4Address('255.255.255.255')).toBe(true);
    expect(isValidIpv4Address('1.1.1')).toBe(false);
    expect(isValidIpv4Address('1.1.1.256')).toBe(false);
    expect(isValidIpv4Address('01.1.1.1')).toBe(false);
    expect(isValidIpv4Address('localhost')).toBe(false);
  });
});

describe('isValidIpv6Address', () => {
  it('accepts full, compressed and IPv4-mapped forms', () => {
    expect(isValidIpv6Address('2001:0db8:0000:0000:0000:0000:0000:0001')).toBe(
      true,
    );
    expect(isValidIpv6Address('2001:db8::1')).toBe(true);
    expect(isValidIpv6Address('::')).toBe(true);
    expect(isValidIpv6Address('::1')).toBe(true);
    expect(isValidIpv6Address('fe80::1')).toBe(true);
    expect(isValidIpv6Address('1:2:3:4:5:6:7::')).toBe(true);
    expect(isValidIpv6Address('::ffff:192.168.0.1')).toBe(true);
  });

  it('rejects malformed addresses', () => {
    expect(isValidIpv6Address('2001:db8')).toBe(false);
    expect(isValidIpv6Address('2001::db8::1')).toBe(false);
    expect(isValidIpv6Address('1:2:3:4:5:6:7:8:9')).toBe(false);
    expect(isValidIpv6Address('12345::1')).toBe(false);
    expect(isValidIpv6Address('::ffff:999.1.1.1')).toBe(false);
    expect(isValidIpv6Address('example.com')).toBe(false);
  });
});

describe('isPrivateOrReservedHost', () => {
  it('blocks loopback, RFC1918, CGNAT and IPv4-mapped forms', async () => {
    const { isPrivateOrReservedHost } = await import('./networkAddresses');
    expect(isPrivateOrReservedHost('localhost')).toBe(true);
    expect(isPrivateOrReservedHost('10.0.0.5')).toBe(true);
    expect(isPrivateOrReservedHost('192.168.1.1')).toBe(true);
    expect(isPrivateOrReservedHost('127.0.0.1')).toBe(true);
    expect(isPrivateOrReservedHost('169.254.1.1')).toBe(true);
    expect(isPrivateOrReservedHost('100.64.0.1')).toBe(true);
    expect(isPrivateOrReservedHost('172.16.0.1')).toBe(true);
    expect(isPrivateOrReservedHost('::1')).toBe(true);
    expect(isPrivateOrReservedHost('fe80::1')).toBe(true);
    expect(isPrivateOrReservedHost('fd12:3456::1')).toBe(true);
    expect(isPrivateOrReservedHost('::ffff:192.168.0.1')).toBe(true);
    expect(isPrivateOrReservedHost('1.1.1.1')).toBe(false);
    expect(isPrivateOrReservedHost('2001:db8::1')).toBe(false);
    expect(isPrivateOrReservedHost('example.com')).toBe(false);
  });
});

describe('isValidIpOrCidr', () => {
  it('accepts bare addresses and prefixes within range', () => {
    expect(isValidIpOrCidr('10.0.0.0/8')).toBe(true);
    expect(isValidIpOrCidr('192.168.1.1')).toBe(true);
    expect(isValidIpOrCidr('2001:db8::/32')).toBe(true);
    expect(isValidIpOrCidr('::/0')).toBe(true);
  });

  it('rejects out-of-range or malformed prefixes', () => {
    expect(isValidIpOrCidr('10.0.0.0/33')).toBe(false);
    expect(isValidIpOrCidr('2001:db8::/129')).toBe(false);
    expect(isValidIpOrCidr('10.0.0.0/')).toBe(false);
    expect(isValidIpOrCidr('10.0.0.0/8/8')).toBe(false);
    expect(isValidIpOrCidr('example.com/24')).toBe(false);
  });
});
