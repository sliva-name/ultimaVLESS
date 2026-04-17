import { ConnectionMode, VlessConfig } from '@/shared/types';
import { AddSubscriptionPayload, UpdateSubscriptionPayload } from '@/shared/ipc';
export { redactUrl } from '@/main/utils/redactUrl';

const MAX_SUBSCRIPTION_URL_LENGTH = 4096;
const MAX_SUBSCRIPTION_NAME_LENGTH = 100;
const MAX_MANUAL_LINKS_LENGTH = 1_000_000;

export function normalizeAddSubscriptionPayload(payload: unknown): AddSubscriptionPayload {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid subscription payload');
  }
  const p = payload as Record<string, unknown>;
  const name = typeof p.name === 'string' ? p.name.trim() : '';
  const url = typeof p.url === 'string' ? p.url.trim() : '';
  if (!name) throw new Error('Subscription name is required');
  if (name.length > MAX_SUBSCRIPTION_NAME_LENGTH) {
    throw new Error(`Subscription name is too long (max ${MAX_SUBSCRIPTION_NAME_LENGTH} characters)`);
  }
  if (!url) throw new Error('Subscription URL is required');
  if (url.length > MAX_SUBSCRIPTION_URL_LENGTH) {
    throw new Error(`Subscription URL is too long (max ${MAX_SUBSCRIPTION_URL_LENGTH} characters)`);
  }
  return { name, url };
}

export function normalizeUpdateSubscriptionPayload(payload: unknown): UpdateSubscriptionPayload {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid subscription payload');
  }
  const p = payload as Record<string, unknown>;
  const id = typeof p.id === 'string' ? p.id.trim() : '';
  if (!id) throw new Error('Subscription id is required');

  const nested =
    p.patch && typeof p.patch === 'object'
      ? (p.patch as Record<string, unknown>)
      : {};

  // Renderer uses `{ id, patch: { ... } }`; tests and legacy callers use flat `{ id, name, url, enabled }`.
  const nameRaw = typeof p.name === 'string' ? p.name : typeof nested.name === 'string' ? nested.name : undefined;
  const urlRaw = typeof p.url === 'string' ? p.url : typeof nested.url === 'string' ? nested.url : undefined;
  const enabledRaw =
    typeof p.enabled === 'boolean' ? p.enabled : typeof nested.enabled === 'boolean' ? nested.enabled : undefined;

  const patch: UpdateSubscriptionPayload['patch'] = {};
  if (typeof nameRaw === 'string') {
    const name = nameRaw.trim();
    if (name.length > MAX_SUBSCRIPTION_NAME_LENGTH) {
      throw new Error(`Subscription name is too long (max ${MAX_SUBSCRIPTION_NAME_LENGTH} characters)`);
    }
    patch.name = name;
  }
  if (typeof urlRaw === 'string') {
    const url = urlRaw.trim();
    if (url.length > MAX_SUBSCRIPTION_URL_LENGTH) {
      throw new Error(`Subscription URL is too long (max ${MAX_SUBSCRIPTION_URL_LENGTH} characters)`);
    }
    patch.url = url;
  }
  if (typeof enabledRaw === 'boolean') {
    patch.enabled = enabledRaw;
  }

  return { id, patch };
}

export function normalizeManualLinks(payload: unknown): string {
  if (typeof payload === 'string') {
    if (payload.length > MAX_MANUAL_LINKS_LENGTH) {
      throw new Error(`Manual links payload is too large (max ${MAX_MANUAL_LINKS_LENGTH} characters)`);
    }
    return payload.trim();
  }
  throw new Error('Invalid manual links payload');
}

export function assertValidServerPayload(payload: unknown): VlessConfig {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid server payload');
  }
  const server = payload as Partial<VlessConfig>;
  const port = server.port;
  const uuid = typeof server.uuid === 'string' ? server.uuid.trim() : '';
  const name = typeof server.name === 'string' ? server.name.trim() : '';
  const address = typeof server.address === 'string' ? server.address.trim() : '';
  if (
    uuid.length < 6 ||
    name.length === 0 ||
    address.length === 0 ||
    typeof port !== 'number' ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  ) {
    throw new Error('Invalid server payload');
  }
  return server as VlessConfig;
}

export function assertBoolean(value: unknown, fieldName: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`Invalid ${fieldName}: expected boolean`);
  }
  return value;
}

export function assertConnectionMode(value: unknown): ConnectionMode {
  if (value !== 'proxy' && value !== 'tun') {
    throw new Error('Invalid connection mode');
  }
  return value;
}
