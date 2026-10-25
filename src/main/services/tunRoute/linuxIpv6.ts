import fs from 'fs';

/**
 * Whether the TUN interface Xray creates can take an IPv6 address. Xray stops
 * at the first `gateway` address it cannot add, so on a kernel without IPv6
 * (`ipv6.disable=1`: no `/proc/net/if_inet6`) or with IPv6 switched off by
 * sysctl (new interfaces copy `conf/default`) TUN would not start at all.
 */
export function isLinuxIpv6Available(
  readFile: (path: string) => string = (path) => fs.readFileSync(path, 'utf8'),
  exists: (path: string) => boolean = fs.existsSync,
): boolean {
  if (!exists('/proc/net/if_inet6')) return false;
  for (const scope of ['all', 'default']) {
    try {
      if (
        readFile(`/proc/sys/net/ipv6/conf/${scope}/disable_ipv6`).trim() === '1'
      ) {
        return false;
      }
    } catch {
      // Unreadable: leave the decision to the other checks.
    }
  }
  return true;
}
