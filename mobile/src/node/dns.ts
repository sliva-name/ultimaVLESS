import { UltimaCore } from '../native/UltimaCore';

export interface LookupAddress {
  address: string;
  family: number;
}

/** `dns.promises.lookup(host, { all: true })` through the platform resolver. */
async function lookup(
  hostname: string,
  options?: { all?: boolean },
): Promise<LookupAddress[]> {
  const { addresses } = await UltimaCore.dnsLookup({ hostname });
  if (addresses.length === 0) {
    const error = new Error(`getaddrinfo ENOTFOUND ${hostname}`);
    (error as Error & { code: string }).code = 'ENOTFOUND';
    throw error;
  }
  return options?.all === false ? addresses.slice(0, 1) : addresses;
}

export const promises = { lookup };

export default { promises };
