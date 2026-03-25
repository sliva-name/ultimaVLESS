import { VlessConfig } from '../../shared/types';

export type SaveConfigsPayload = { subscriptionUrl: string; manualLinks: string };
const MAX_SUBSCRIPTION_URL_LENGTH = 4096;
const MAX_MANUAL_LINKS_LENGTH = 1_000_000;

function normalizeAndValidatePayload(subscriptionUrl: string, manualLinks: string): SaveConfigsPayload {
  if (subscriptionUrl.length > MAX_SUBSCRIPTION_URL_LENGTH) {
    throw new Error(`Subscription URL is too long (max ${MAX_SUBSCRIPTION_URL_LENGTH} characters)`);
  }
  if (manualLinks.length > MAX_MANUAL_LINKS_LENGTH) {
    throw new Error(`Manual links payload is too large (max ${MAX_MANUAL_LINKS_LENGTH} characters)`);
  }

  return {
    subscriptionUrl: subscriptionUrl.trim(),
    manualLinks: manualLinks.trim(),
  };
}

export function redactUrl(url: string): string {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return '[invalid-url]';
  }
}

export function normalizeSavePayload(payload: unknown): SaveConfigsPayload {
  if (typeof payload === 'string') {
    return normalizeAndValidatePayload(payload, '');
  }
  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid subscription payload');
  }
  const candidate = payload as Partial<SaveConfigsPayload>;
  if (typeof candidate.subscriptionUrl !== 'string' || typeof candidate.manualLinks !== 'string') {
    throw new Error('Invalid subscription payload');
  }

  return normalizeAndValidatePayload(candidate.subscriptionUrl, candidate.manualLinks);
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
