/**
 * Windows TUN environment as the settings UI sees it: the adapters Xray can be
 * bound to, and third-party VPN/proxy software that fights over the same
 * routes and sockets.
 */

/** How an adapter is presented; only `physical` ones are preferred automatically. */
export type NetworkAdapterKind = 'physical' | 'virtual' | 'vpn';

export interface NetworkAdapterView {
  /** Windows adapter name (alias) — the value stored in `tunOutboundInterface`. */
  name: string;
  /** Driver description (`Intel(R) Wi-Fi 6E AX210`), when it could be read. */
  description: string | null;
  ipv4: string[];
  /** IPv4 default gateway, or null when this adapter cannot reach the internet. */
  gateway: string | null;
  kind: NetworkAdapterKind;
  /** The adapter automatic selection would use right now. */
  isAutomaticChoice: boolean;
}

export interface NetworkAdapterList {
  /** False on platforms where the outbound adapter is not user-selectable. */
  supported: boolean;
  adapters: NetworkAdapterView[];
}

/**
 * `vpn` — a tunnel of its own; `proxy` — redirects other apps' connections;
 * `dpi` — packet-level DPI bypass (WinDivert) that rewrites Xray's traffic;
 * `core` — a standalone Xray/sing-box/mihomo started by another client.
 */
export type ConflictingAppCategory = 'vpn' | 'proxy' | 'dpi' | 'core';

export interface ConflictingAppProcess {
  pid: number;
  image: string;
}

export interface ConflictingAppView {
  id: string;
  name: string;
  category: ConflictingAppCategory;
  /** User-level processes UltimaVLESS may terminate on request. */
  processes: ConflictingAppProcess[];
  /**
   * Background services of the same product. They are never terminated: the
   * service manager restarts them, and killing a tunnel service can leave its
   * kill-switch firewall rules behind. The user disconnects in that app.
   */
  services: ConflictingAppProcess[];
}

export interface ConflictingAppsScan {
  supported: boolean;
  apps: ConflictingAppView[];
}

/**
 * The check main runs alongside each TUN connect attempt (and again when it
 * fails), carried to the renderer in the app snapshot.
 */
export interface TunConflictCheck {
  /** New for every attempt; the renderer keys "dismissed" on it. */
  id: number;
  /** Null until the first scan of this attempt finishes. */
  scan: ConflictingAppsScan | null;
  /** The user closed at least one app since the attempt started. */
  resolved: boolean;
}

export interface CloseConflictingAppResult {
  /** True when none of the app's closable processes is still running. */
  closed: boolean;
  /** Processes that survived termination (access denied, protected, ...). */
  remaining: ConflictingAppProcess[];
  /** Fresh scan after the attempt, so the UI can redraw without a second call. */
  scan: ConflictingAppsScan;
}
