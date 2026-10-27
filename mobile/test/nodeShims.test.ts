import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { createHash } from '../src/node/crypto';
import { BlockList, isIP } from '../src/node/net';
import * as path from '../src/node/path';

// The test config aliases `crypto`, `net` and `path` to the shims under test;
// `require` reaches Node's own modules past those aliases.
const nodeRequire = createRequire(import.meta.url);
const { createHash: nodeCreateHash } = nodeRequire(
  'crypto',
) as typeof import('node:crypto');
const { BlockList: NodeBlockList, isIP: nodeIsIP } = nodeRequire(
  'net',
) as typeof import('node:net');
const { posix: nodePath } = nodeRequire('path') as typeof import('node:path');

it('compares against the real Node modules', () => {
  expect(nodeCreateHash).not.toBe(createHash);
  expect(nodeIsIP).not.toBe(isIP);
});

describe('crypto shim', () => {
  it('matches Node SHA-256 digests, which catalog ids are built from', () => {
    const inputs = [
      '',
      'abc',
      'x'.repeat(55),
      'x'.repeat(56),
      'x'.repeat(64),
      'пароль|203.0.113.10|443',
      'a'.repeat(10_000),
    ];
    for (const input of inputs) {
      expect(createHash('sha256').update(input).digest('hex')).toBe(
        nodeCreateHash('sha256').update(input).digest('hex'),
      );
    }
  });
});

describe('net shim', () => {
  it('classifies addresses like Node', () => {
    const inputs = [
      '1.2.3.4',
      '255.255.255.255',
      '256.1.1.1',
      '01.2.3.4',
      '::',
      '::1',
      'fe80::1%eth0',
      '2001:db8::8a2e:370:7334',
      '::ffff:127.0.0.1',
      '1:2:3:4:5:6:7:8',
      '1:2:3:4:5:6:7:8:9',
      '1::2::3',
      'example.com',
      '',
      '[::1]',
    ];
    for (const input of inputs) {
      expect(isIP(input), input).toBe(nodeIsIP(input));
    }
  });

  it('matches subnets, including IPv4-mapped IPv6, like Node BlockList', () => {
    const ours = new BlockList();
    const theirs = new NodeBlockList();
    for (const [address, prefix, family] of [
      ['10.0.0.0', 8, 'ipv4'],
      ['172.16.0.0', 12, 'ipv4'],
      ['fc00::', 7, 'ipv6'],
      ['::', 127, 'ipv6'],
    ] as const) {
      ours.addSubnet(address, prefix, family);
      theirs.addSubnet(address, prefix, family);
    }
    for (const [address, family] of [
      ['10.1.2.3', 'ipv4'],
      ['11.0.0.1', 'ipv4'],
      ['172.31.255.255', 'ipv4'],
      ['172.32.0.1', 'ipv4'],
      ['fd00::1', 'ipv6'],
      ['2001:db8::1', 'ipv6'],
      ['::1', 'ipv6'],
      ['::ffff:10.0.0.1', 'ipv6'],
      ['::ffff:8.8.8.8', 'ipv6'],
    ] as const) {
      expect(ours.check(address, family), address).toBe(
        theirs.check(address, family),
      );
    }
  });
});

describe('path shim', () => {
  it('joins and splits POSIX paths like Node', () => {
    const cases = [
      ['/data/user/0/app/files', 'xray.log'],
      ['/a/b', '../c', './d'],
      ['a', '', 'b/'],
    ];
    for (const segments of cases) {
      expect(path.join(...segments)).toBe(nodePath.join(...segments));
    }
    for (const input of ['/a/b/c.log', '/a', 'file', '/', '/a/b/']) {
      expect(path.dirname(input)).toBe(nodePath.dirname(input));
      expect(path.basename(input)).toBe(nodePath.basename(input));
    }
  });
});
