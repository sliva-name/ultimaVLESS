/**
 * One server's parameters for its details card. Main sends them on request,
 * for a single server: the snapshot itself never carries credentials.
 */

/** How each outbound protocol is written in the UI. */
export const PROTOCOL_NAMES: Record<string, string> = {
  vless: 'VLESS',
  vmess: 'VMess',
  trojan: 'Trojan',
  shadowsocks: 'Shadowsocks',
  hysteria: 'Hysteria',
  wireguard: 'WireGuard',
};

export type ServerDetailKey =
  | 'protocol'
  | 'address'
  | 'port'
  | 'userId'
  | 'password'
  | 'method'
  | 'encryption'
  | 'flow'
  | 'transport'
  | 'security'
  | 'sni'
  | 'fingerprint'
  | 'alpn'
  | 'host'
  | 'path'
  | 'serviceName'
  | 'mode'
  | 'publicKey'
  | 'shortId'
  | 'spiderX'
  | 'obfs'
  | 'obfsPassword'
  | 'bandwidthUp'
  | 'bandwidthDown'
  | 'wgPrivateKey'
  | 'wgAddress'
  | 'wgEndpoint'
  | 'wgPublicKey'
  | 'wgPreSharedKey'
  | 'mtu';

export interface ServerDetailField {
  key: ServerDetailKey;
  value: string;
  /** A credential: masked until the viewer asks to see it. */
  secret?: boolean;
}

export interface ServerDetails {
  /** Only the parameters this server has, in reading order. */
  fields: ServerDetailField[];
  /** The link it was parsed from; absent for JSON servers and older entries. */
  shareLink?: string;
  /** JSON-subscription servers: the provider's Xray config, pretty-printed. */
  rawConfig?: string;
}
