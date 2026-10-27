/** IPv4/IPv6 parsing shared by the `net` shim and its BlockList. */

const IPV4_PART = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;

export function parseIpv4(input: string): number | null {
  const parts = input.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!IPV4_PART.test(part)) return null;
    value = value * 256 + Number(part);
  }
  return value;
}

/** 128-bit value of an IPv6 address; a `%zone` suffix is accepted, as by Node. */
export function parseIpv6(input: string): bigint | null {
  let text = input;
  const zone = text.indexOf('%');
  if (zone !== -1) {
    if (zone === text.length - 1) return null;
    text = text.slice(0, zone);
  }
  if (text.length < 2 || !/^[0-9a-fA-F:.]+$/.test(text)) return null;

  let tail: number[] = [];
  const lastColon = text.lastIndexOf(':');
  if (text.slice(lastColon + 1).includes('.')) {
    const v4 = parseIpv4(text.slice(lastColon + 1));
    if (v4 === null) return null;
    tail = [Math.floor(v4 / 65536), v4 % 65536];
    text = `${text.slice(0, lastColon + 1)}0`;
  }

  const halves = text.split('::');
  if (halves.length > 2) return null;
  const parseGroups = (part: string): number[] | null => {
    if (part === '') return [];
    const groups = part.split(':');
    const out: number[] = [];
    for (const group of groups) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
      out.push(parseInt(group, 16));
    }
    return out;
  };
  const head = parseGroups(halves[0]);
  const rest = halves.length === 2 ? parseGroups(halves[1]) : [];
  if (!head || !rest) return null;

  let groups: number[];
  if (tail.length > 0) {
    // The placeholder `0` group stands for the dotted IPv4 tail.
    const all = halves.length === 2 ? rest : head;
    all.pop();
  }
  const explicit = head.length + rest.length + tail.length;
  if (halves.length === 2) {
    if (explicit > 7) return null;
    groups = [
      ...head,
      ...new Array<number>(8 - explicit).fill(0),
      ...rest,
      ...tail,
    ];
  } else {
    if (explicit !== 8) return null;
    groups = [...head, ...tail];
  }

  let value = 0n;
  for (const group of groups) value = (value << 16n) | BigInt(group);
  return value;
}

export function ipVersion(input: string): 0 | 4 | 6 {
  if (parseIpv4(input) !== null) return 4;
  if (input.includes(':') && parseIpv6(input) !== null) return 6;
  return 0;
}
