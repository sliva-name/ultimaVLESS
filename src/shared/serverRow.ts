/**
 * UI row identity for the sidebar. Catalog uuid can collide across distinct
 * tunnels (same stored id, different SNI/name); selection must follow the
 * clicked row, not every copy of that uuid.
 */
export type ServerRowIdentity = {
  uuid: string;
  name: string;
  address: string;
  port: number;
  sni?: string;
};

export function isSameServerRow(
  left: ServerRowIdentity,
  right: ServerRowIdentity,
): boolean {
  return (
    left.uuid === right.uuid &&
    left.name === right.name &&
    left.address === right.address &&
    left.port === right.port &&
    (left.sni ?? '') === (right.sni ?? '')
  );
}

export function findServerRow<T extends ServerRowIdentity>(
  servers: T[],
  target: ServerRowIdentity | null | undefined,
): T | undefined {
  if (!target) {
    return undefined;
  }
  return (
    servers.find((server) => isSameServerRow(server, target)) ??
    servers.find(
      (server) =>
        server.name === target.name &&
        server.address === target.address &&
        server.port === target.port &&
        (server.sni ?? '') === (target.sni ?? ''),
    ) ??
    servers.find((server) => server.uuid === target.uuid)
  );
}
