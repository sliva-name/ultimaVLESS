import type { PerformanceSettings, VlessConfig } from '@/shared/types';
import {
  PROTOCOL_NAMES,
  type ServerDetailField,
  type ServerDetailKey,
  type ServerDetails,
} from '@/shared/views/serverDetails';
import {
  withHysteriaBandwidth,
  type HysteriaRateSource,
} from './configGenerator/hysteriaBandwidth';

/** A Brutal rate as the config writes it (`50 mbps`); "0" declares none. */
function readRate(value: unknown): string | undefined {
  const text = typeof value === 'string' ? value.trim() : '';
  return text !== '' && text !== '0' ? text : undefined;
}

/** The Brutal rates the compiled config declares for this server. */
function declaredRates(
  server: VlessConfig,
  ...sources: HysteriaRateSource[]
): Record<string, unknown> | undefined {
  return withHysteriaBandwidth(
    server.finalmask ? { ...server.finalmask } : undefined,
    server,
    ...sources,
  )?.quicParams as Record<string, unknown> | undefined;
}

/**
 * The parameters a person would compare with their provider's panel, in
 * that order: endpoint, credentials, then transport and TLS. Fields the
 * server does not have are left out. `perf` adds what this device's
 * settings put into the config (the Hysteria2 speed).
 */
export function buildServerDetails(
  server: VlessConfig,
  perf?: Pick<PerformanceSettings, 'hysteriaUpMbps' | 'hysteriaDownMbps'>,
): ServerDetails {
  const fields: ServerDetailField[] = [];
  const add = (
    key: ServerDetailKey,
    value: unknown,
    secret = false,
    fromDevice = false,
  ): void => {
    const text = Array.isArray(value)
      ? value.filter((item) => item !== '').join(', ')
      : value === undefined || value === null
        ? ''
        : String(value);
    if (!text) return;
    const field: ServerDetailField = { key, value: text };
    if (secret) field.secret = true;
    if (fromDevice) field.fromDevice = true;
    fields.push(field);
  };

  const protocol = server.protocol ?? 'vless';
  add('protocol', PROTOCOL_NAMES[protocol] ?? protocol);
  add('address', server.address);
  add('port', server.port);

  if (protocol === 'wireguard') {
    add('wgPrivateKey', server.wgSecretKey, true);
    add('wgAddress', server.wgAddress);
    for (const peer of server.wgPeers ?? []) {
      add('wgEndpoint', peer.endpoint);
      add('wgPublicKey', peer.publicKey);
      add('wgPreSharedKey', peer.preSharedKey, true);
    }
    add('mtu', server.wgMtu);
  } else {
    add('userId', server.userId, true);
    add('password', server.password, true);
    add('method', server.method);
    add(
      'encryption',
      protocol === 'vmess' ? server.vmessSecurity : server.encryption,
    );
    add('flow', server.flow);
    if (protocol !== 'shadowsocks' && protocol !== 'hysteria') {
      add('transport', server.type ?? 'tcp');
    }
    add('security', server.security);
    add('sni', server.sni);
    add('fingerprint', server.fp);
    add('alpn', server.alpn);
    add('host', server.host);
    add('path', server.path);
    add('serviceName', server.serviceName);
    add('mode', server.mode);
    add('publicKey', server.pbk);
    add('shortId', server.sid);
    add('spiderX', server.spx);
    add('obfs', server.hysteriaObfs?.type);
    add('obfsPassword', server.hysteriaObfs?.password, true);
    if (protocol === 'hysteria') {
      // The rates the client declares: the link's own (`fm` included), else
      // this device's setting, marked as such.
      const own = declaredRates(server);
      const all = perf ? declaredRates(server, perf) : own;
      for (const [key, param] of [
        ['bandwidthUp', 'brutalUp'],
        ['bandwidthDown', 'brutalDown'],
      ] as const) {
        const rate = readRate(all?.[param]);
        add(key, rate, false, rate !== undefined && own?.[param] === undefined);
      }
    }
  }

  const details: ServerDetails = { fields };
  if (server.shareLink) details.shareLink = server.shareLink;
  if (server.rawConfig) {
    details.rawConfig = JSON.stringify(server.rawConfig, null, 2);
  }
  return details;
}
