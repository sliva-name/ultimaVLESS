import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  isGeodataEntryAvailable,
  parseGeodataReference,
  toGeodataCatalog,
} from '@/shared/geodata';
import {
  loadBundledGeodataTags,
  readGeodataTags,
} from '@/main/services/xray/bundledGeodata';

function varint(value: number): number[] {
  const bytes: number[] = [];
  let rest = value;
  while (rest >= 0x80) {
    bytes.push((rest % 0x80) | 0x80);
    rest = Math.floor(rest / 0x80);
  }
  bytes.push(rest);
  return bytes;
}

function lengthDelimited(field: number, payload: number[]): number[] {
  return [...varint(field * 8 + 2), ...varint(payload.length), ...payload];
}

/** A GeoIP/GeoSite entry: country_code = 1, items = 2, optional varint = 3. */
function datEntry(
  code: string,
  items: number,
  options: { flagFirst?: boolean } = {},
): number[] {
  const flag = [...varint(3 * 8), 1];
  const body = [
    ...(options.flagFirst ? flag : []),
    ...lengthDelimited(1, [...Buffer.from(code)]),
    ...Array.from({ length: items }).flatMap(() =>
      lengthDelimited(2, [0x0a, 0x04, 10, 0, 0, 1]),
    ),
    ...(options.flagFirst ? [] : flag),
  ];
  return lengthDelimited(1, body);
}

function datFile(...entries: number[][]): Uint8Array {
  return Uint8Array.from(entries.flat());
}

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('geodata references', () => {
  it('follows Xray syntax for negation and attributes', () => {
    expect(parseGeodataReference('geoip:US')).toEqual({
      file: 'geoip',
      tag: 'us',
    });
    expect(parseGeodataReference('!!geoip:!ru')).toEqual({
      file: 'geoip',
      tag: 'ru',
    });
    expect(parseGeodataReference('geosite:google@cn@ads')).toEqual({
      file: 'geosite',
      tag: 'google',
    });
    // Domain lists take `!` literally, and `ext:` names its own file.
    expect(parseGeodataReference('!geosite:google')).toBeNull();
    expect(parseGeodataReference('ext:geoip.dat:us')).toBeNull();
    expect(parseGeodataReference('example.com')).toBeNull();
    expect(parseGeodataReference('10.0.0.0/8')).toBeNull();
  });

  it('flags only lists the bundled files lack', () => {
    const catalog = toGeodataCatalog({
      geoip: ['private', 'RU'],
      geosite: ['category-ads-all'],
    });

    expect(isGeodataEntryAvailable('geoip:ru', catalog)).toBe(true);
    expect(isGeodataEntryAvailable('!geoip:private', catalog)).toBe(true);
    expect(
      isGeodataEntryAvailable('geosite:category-ads-all@ads', catalog),
    ).toBe(true);
    expect(isGeodataEntryAvailable('geoip:us', catalog)).toBe(false);
    expect(isGeodataEntryAvailable('geosite:win-spy', catalog)).toBe(false);
    expect(isGeodataEntryAvailable('geoip:', catalog)).toBe(false);
    expect(isGeodataEntryAvailable('full:example.com', catalog)).toBe(true);
  });
});

describe('bundled geodata', () => {
  it('reads list names without decoding their contents', () => {
    const data = datFile(
      datEntry('PRIVATE', 3),
      datEntry('RU', 200),
      datEntry('category-ads-all', 1, { flagFirst: true }),
    );

    expect(readGeodataTags(data)).toEqual([
      'private',
      'ru',
      'category-ads-all',
    ]);
  });

  it('rejects files that are not a list of entries', () => {
    expect(() => readGeodataTags(Uint8Array.from([0x12, 0x01, 0x00]))).toThrow(
      /Unexpected field key/,
    );
    const truncated = datFile(datEntry('RU', 2)).slice(0, -3);
    expect(() => readGeodataTags(truncated)).toThrow(/Truncated/);
  });

  it('loads both files once and retries after a failed read', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'geodata-'));
    tempDirs.push(dir);

    await expect(loadBundledGeodataTags(dir)).resolves.toBeNull();

    fs.writeFileSync(path.join(dir, 'geoip.dat'), datFile(datEntry('RU', 1)));
    fs.writeFileSync(
      path.join(dir, 'geosite.dat'),
      datFile(datEntry('CATEGORY-RU', 1)),
    );
    const tags = await loadBundledGeodataTags(dir);
    expect(tags).toEqual({ geoip: ['ru'], geosite: ['category-ru'] });

    fs.rmSync(path.join(dir, 'geoip.dat'));
    await expect(loadBundledGeodataTags(dir)).resolves.toBe(tags);
  });
});
