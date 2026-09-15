import type {
  LinuxProxySnapshot,
  MacosProxySnapshot,
  MacosServiceProxySnapshot,
  ProxySnapshot,
  WindowsProxySnapshot,
} from './types';

const PROXY_SERVER_RE = /^[A-Za-z0-9.:[\]=;_-]*$/;
const PROXY_OVERRIDE_RE = /^[A-Za-z0-9.:*;,_\-/<> ]*$/;
const HOST_RE = /^[A-Za-z0-9.:[\]_-]*$/;
const SERVICE_NAME_RE = /^[\x20-\x7E]{1,128}$/;

function isFlag(value: unknown): value is number {
  return value === 0 || value === 1;
}

function isPort(value: unknown): value is number | null {
  if (value === null) return true;
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 65535
  );
}

function isSafeHost(value: unknown): value is string | null {
  if (value === null) return true;
  return (
    typeof value === 'string' && value.length <= 255 && HOST_RE.test(value)
  );
}

function isSafeProxyServer(value: unknown): value is string | null {
  if (value === null) return true;
  return (
    typeof value === 'string' &&
    value.length <= 512 &&
    PROXY_SERVER_RE.test(value)
  );
}

function isSafeOverride(value: unknown): value is string | null {
  if (value === null) return true;
  return (
    typeof value === 'string' &&
    value.length <= 2048 &&
    PROXY_OVERRIDE_RE.test(value)
  );
}

function isSafeAutoConfigUrl(value: unknown): value is string | null {
  if (value === null || value === '') return true;
  if (typeof value !== 'string' || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function parseWindows(
  value: Record<string, unknown>,
): WindowsProxySnapshot | null {
  if (!isFlag(value.proxyEnable) || !isFlag(value.autoDetect)) {
    return null;
  }
  if (
    !isSafeProxyServer(value.proxyServer) ||
    !isSafeOverride(value.proxyOverride) ||
    !isSafeAutoConfigUrl(value.autoConfigUrl)
  ) {
    return null;
  }
  return {
    platform: 'win32',
    proxyEnable: value.proxyEnable,
    proxyServer: value.proxyServer,
    proxyOverride: value.proxyOverride,
    autoConfigUrl: value.autoConfigUrl,
    autoDetect: value.autoDetect,
  };
}

function parseMacService(value: unknown): MacosServiceProxySnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (typeof row.service !== 'string' || !SERVICE_NAME_RE.test(row.service)) {
    return null;
  }
  if (
    typeof row.webEnabled !== 'boolean' ||
    typeof row.secureEnabled !== 'boolean' ||
    typeof row.socksEnabled !== 'boolean'
  ) {
    return null;
  }
  if (
    !isSafeHost(row.webHost) ||
    !isSafeHost(row.secureHost) ||
    !isSafeHost(row.socksHost) ||
    !isPort(row.webPort) ||
    !isPort(row.securePort) ||
    !isPort(row.socksPort)
  ) {
    return null;
  }
  if (!Array.isArray(row.bypassDomains)) return null;
  const bypassDomains: string[] = [];
  for (const domain of row.bypassDomains) {
    if (
      typeof domain !== 'string' ||
      domain.length > 255 ||
      /\r|\n/.test(domain)
    ) {
      return null;
    }
    bypassDomains.push(domain);
  }
  return {
    service: row.service,
    webEnabled: row.webEnabled,
    webHost: row.webHost,
    webPort: row.webPort,
    secureEnabled: row.secureEnabled,
    secureHost: row.secureHost,
    securePort: row.securePort,
    socksEnabled: row.socksEnabled,
    socksHost: row.socksHost,
    socksPort: row.socksPort,
    bypassDomains,
  };
}

function parseDarwin(
  value: Record<string, unknown>,
): MacosProxySnapshot | null {
  if (!Array.isArray(value.services) || value.services.length > 32) {
    return null;
  }
  const services: MacosServiceProxySnapshot[] = [];
  for (const service of value.services) {
    const parsed = parseMacService(service);
    if (!parsed) return null;
    services.push(parsed);
  }
  return { platform: 'darwin', services };
}

function parseLinux(value: Record<string, unknown>): LinuxProxySnapshot | null {
  if (value.backend !== 'gsettings' && value.backend !== 'unsupported') {
    return null;
  }
  if (typeof value.mode !== 'string' || value.mode.length > 32) {
    return null;
  }
  if (
    !isSafeHost(value.httpHost) ||
    !isSafeHost(value.httpsHost) ||
    !isSafeHost(value.socksHost) ||
    typeof value.httpHost !== 'string' ||
    typeof value.httpsHost !== 'string' ||
    typeof value.socksHost !== 'string'
  ) {
    return null;
  }
  if (
    !isPort(value.httpPort) ||
    !isPort(value.httpsPort) ||
    !isPort(value.socksPort) ||
    value.httpPort === null ||
    value.httpsPort === null ||
    value.socksPort === null
  ) {
    return null;
  }
  if (!Array.isArray(value.ignoreHosts)) return null;
  const ignoreHosts: string[] = [];
  for (const host of value.ignoreHosts) {
    if (typeof host !== 'string' || host.length > 255 || /\r|\n/.test(host)) {
      return null;
    }
    ignoreHosts.push(host);
  }
  return {
    platform: 'linux',
    backend: value.backend,
    mode: value.mode,
    httpHost: value.httpHost,
    httpPort: value.httpPort,
    httpsHost: value.httpsHost,
    httpsPort: value.httpsPort,
    socksHost: value.socksHost,
    socksPort: value.socksPort,
    ignoreHosts,
  };
}

/**
 * Accepts only a snapshot this process could have written. A forged file in
 * userData (or a ProgramData target pointing at one) must not become WinINET /
 * gsettings / networksetup input.
 */
export function parseProxySnapshot(raw: unknown): ProxySnapshot | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const value = raw as Record<string, unknown>;
  if (value.platform === 'win32') {
    return parseWindows(value);
  }
  if (value.platform === 'darwin') {
    return parseDarwin(value);
  }
  if (value.platform === 'linux') {
    return parseLinux(value);
  }
  return null;
}

export function parseProxySnapshotJson(text: string): ProxySnapshot | null {
  try {
    return parseProxySnapshot(JSON.parse(text) as unknown);
  } catch {
    return null;
  }
}
