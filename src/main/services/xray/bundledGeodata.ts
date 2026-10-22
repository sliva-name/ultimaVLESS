import { promises as fsPromises } from 'fs';
import path from 'path';
import type { GeodataTags } from '@/shared/geodata';
import { logger } from '@/main/services/LoggerService';

const pendingByPath = new Map<string, Promise<GeodataTags | null>>();

function readVarint(data: Uint8Array, offset: number): [number, number] {
  let value = 0;
  let scale = 1;
  for (let pos = offset; pos < data.length && pos < offset + 10; pos += 1) {
    const byte = data[pos];
    value += (byte & 0x7f) * scale;
    if ((byte & 0x80) === 0) return [value, pos + 1];
    scale *= 128;
  }
  throw new Error(`Truncated varint at ${offset}`);
}

/** The first `string ... = 1` of an entry, skipping whatever precedes it. */
function readEntryCode(
  data: Uint8Array,
  start: number,
  end: number,
  decoder: TextDecoder,
): string | null {
  let pos = start;
  while (pos < end) {
    const [key, afterKey] = readVarint(data, pos);
    const wireType = key & 7;
    if (wireType === 2) {
      const [length, valueStart] = readVarint(data, afterKey);
      const valueEnd = valueStart + length;
      if (valueEnd > end) throw new Error(`Truncated field at ${pos}`);
      if (Math.floor(key / 8) === 1) {
        return decoder.decode(data.subarray(valueStart, valueEnd));
      }
      pos = valueEnd;
    } else if (wireType === 0) {
      [, pos] = readVarint(data, afterKey);
    } else {
      throw new Error(`Unexpected wire type ${wireType} at ${pos}`);
    }
  }
  return null;
}

/**
 * List names of a geoip.dat / geosite.dat. Both are protobuf
 * `message List { repeated Entry entry = 1; }` with `string country_code = 1`
 * in every entry; the CIDRs and domains of an entry are skipped, not decoded.
 */
export function readGeodataTags(data: Uint8Array): string[] {
  const decoder = new TextDecoder();
  const tags: string[] = [];
  let pos = 0;
  while (pos < data.length) {
    const [key, afterKey] = readVarint(data, pos);
    // Field 1, length-delimited.
    if (key !== 0x0a) throw new Error(`Unexpected field key ${key} at ${pos}`);
    const [length, start] = readVarint(data, afterKey);
    const end = start + length;
    if (end > data.length) throw new Error(`Truncated entry at ${pos}`);
    const code = readEntryCode(data, start, end, decoder);
    if (code) tags.push(code.toLowerCase());
    pos = end;
  }
  return tags;
}

async function readBundledGeodataTags(
  resourcesPath: string,
): Promise<GeodataTags | null> {
  try {
    const [geoip, geosite] = await Promise.all(
      ['geoip.dat', 'geosite.dat'].map(async (name) =>
        readGeodataTags(
          await fsPromises.readFile(path.join(resourcesPath, name)),
        ),
      ),
    );
    return { geoip, geosite };
  } catch (error) {
    logger.warn('BundledGeodata', 'Cannot read the bundled geodata lists', {
      resourcesPath,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Tags of the .dat files Xray loads from `resourcesPath`, read once. Null when
 * they cannot be read: entries then reach Xray unchecked, and it names the
 * missing list itself when it refuses to start.
 */
export function loadBundledGeodataTags(
  resourcesPath: string,
): Promise<GeodataTags | null> {
  let pending = pendingByPath.get(resourcesPath);
  if (!pending) {
    pending = readBundledGeodataTags(resourcesPath);
    pendingByPath.set(resourcesPath, pending);
    // A read that failed is retried next time instead of being remembered.
    void pending.then((tags) => {
      if (!tags) pendingByPath.delete(resourcesPath);
    });
  }
  return pending;
}
