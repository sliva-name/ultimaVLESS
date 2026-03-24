import { VlessConfig } from '../../shared/types';

export type SaveConfigsPayload = { subscriptionUrl: string; manualLinks: string };

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
    return { subscriptionUrl: payload, manualLinks: '' };
  }
  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid subscription payload');
  }
  const candidate = payload as Partial<SaveConfigsPayload>;
  if (typeof candidate.subscriptionUrl !== 'string' || typeof candidate.manualLinks !== 'string') {
    throw new Error('Invalid subscription payload');
  }
  return {
    subscriptionUrl: candidate.subscriptionUrl,
    manualLinks: candidate.manualLinks,
  };
}

export function assertValidServerPayload(payload: unknown): VlessConfig {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid server payload');
  }
  const server = payload as Partial<VlessConfig>;
  if (
    typeof server.uuid !== 'string' ||
    server.uuid.trim().length < 6 ||
    typeof server.name !== 'string' ||
    typeof server.address !== 'string' ||
    typeof server.port !== 'number'
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
