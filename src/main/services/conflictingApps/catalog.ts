import type { ConflictingAppCategory } from '@/shared/views/tunEnvironment';

/**
 * Windows software that competes with UltimaVLESS for the routing table,
 * system proxy or Xray's own sockets. Image names are matched
 * case-insensitively against `tasklist`.
 *
 * `images` are user-level processes (GUI, tray, a tunnel process the GUI
 * started); closing them is what the user is offered. `services` are listed
 * so the user knows the product is present, but never terminated — the
 * service manager restarts them, and killing a tunnel service mid-flight can
 * leave its kill-switch firewall filters behind with no way back online.
 */
export interface ConflictingAppDefinition {
  id: string;
  name: string;
  category: ConflictingAppCategory;
  images: string[];
  services?: string[];
}

export const CONFLICTING_APPS: readonly ConflictingAppDefinition[] = [
  // --- VPN clients: own tunnel adapter and default routes -----------------
  {
    id: 'openvpn',
    name: 'OpenVPN',
    category: 'vpn',
    images: ['openvpn-gui.exe', 'openvpn.exe', 'openvpnconnect.exe'],
    services: ['openvpnserv.exe', 'openvpnserv2.exe'],
  },
  {
    id: 'wireguard',
    name: 'WireGuard',
    category: 'vpn',
    // The manager, the UI and every tunnel run as `wireguard.exe` services.
    images: [],
    services: ['wireguard.exe'],
  },
  {
    id: 'amneziawg',
    name: 'AmneziaWG',
    category: 'vpn',
    images: [],
    services: ['amneziawg.exe'],
  },
  {
    id: 'amneziavpn',
    name: 'AmneziaVPN',
    category: 'vpn',
    images: ['amneziavpn.exe'],
    services: ['amneziavpn-service.exe'],
  },
  {
    id: 'nordvpn',
    name: 'NordVPN',
    category: 'vpn',
    images: ['nordvpn.exe'],
    services: ['nordvpn-service.exe'],
  },
  {
    id: 'expressvpn',
    name: 'ExpressVPN',
    category: 'vpn',
    images: ['expressvpn.exe'],
    services: ['expressvpnservice.exe', 'expressvpnd.exe'],
  },
  {
    id: 'protonvpn',
    name: 'Proton VPN',
    category: 'vpn',
    images: ['protonvpn.exe', 'protonvpn.client.exe'],
    services: ['protonvpnservice.exe', 'protonvpn.wireguardservice.exe'],
  },
  {
    id: 'windscribe',
    name: 'Windscribe',
    category: 'vpn',
    images: ['windscribe.exe'],
    services: ['windscribeservice.exe'],
  },
  {
    id: 'surfshark',
    name: 'Surfshark',
    category: 'vpn',
    images: ['surfshark.exe'],
    services: ['surfshark.service.exe'],
  },
  {
    id: 'cyberghost',
    name: 'CyberGhost',
    category: 'vpn',
    images: ['cyberghost.exe'],
    services: ['cyberghost.service.exe'],
  },
  {
    id: 'pia',
    name: 'Private Internet Access',
    category: 'vpn',
    images: ['pia-client.exe'],
    services: ['pia-service.exe'],
  },
  {
    id: 'mullvad',
    name: 'Mullvad VPN',
    category: 'vpn',
    images: ['mullvad vpn.exe'],
    services: ['mullvad-daemon.exe'],
  },
  {
    id: 'hotspotshield',
    name: 'Hotspot Shield',
    category: 'vpn',
    images: ['hotspotshield.exe'],
  },
  {
    id: 'tunnelbear',
    name: 'TunnelBear',
    category: 'vpn',
    images: ['tunnelbear.exe'],
  },
  {
    id: 'warp',
    name: 'Cloudflare WARP',
    category: 'vpn',
    images: ['cloudflare warp.exe'],
    services: ['warp-svc.exe'],
  },
  {
    id: 'adguardvpn',
    name: 'AdGuard VPN',
    category: 'vpn',
    images: ['adguardvpn.exe'],
    services: ['adguardvpnsvc.exe'],
  },
  {
    id: 'kasperskyvpn',
    name: 'Kaspersky VPN',
    category: 'vpn',
    images: ['ksdeui.exe'],
    services: ['ksde.exe'],
  },
  {
    id: 'outline',
    name: 'Outline',
    category: 'vpn',
    images: ['outline.exe'],
    services: ['outlineservice.exe'],
  },
  {
    id: 'psiphon',
    name: 'Psiphon',
    category: 'vpn',
    images: ['psiphon3.exe'],
  },
  {
    id: 'lantern',
    name: 'Lantern',
    category: 'vpn',
    images: ['lantern.exe'],
  },
  {
    id: 'radminvpn',
    name: 'Radmin VPN',
    category: 'vpn',
    images: ['radminvpn.exe'],
    services: ['rvcontrolsvc.exe'],
  },
  {
    id: 'hamachi',
    name: 'LogMeIn Hamachi',
    category: 'vpn',
    images: ['hamachi-2-ui.exe'],
    services: ['hamachi-2.exe'],
  },
  {
    id: 'zerotier',
    name: 'ZeroTier',
    category: 'vpn',
    images: ['zerotier_desktop_ui.exe'],
    services: ['zerotier-one_x64.exe', 'zerotier-one_x86.exe'],
  },
  {
    id: 'tailscale',
    name: 'Tailscale',
    category: 'vpn',
    images: ['tailscale-ipn.exe'],
    services: ['tailscaled.exe'],
  },
  {
    id: 'anyconnect',
    name: 'Cisco Secure Client (AnyConnect)',
    category: 'vpn',
    images: ['vpnui.exe'],
    services: ['vpnagent.exe'],
  },
  {
    id: 'forticlient',
    name: 'FortiClient VPN',
    category: 'vpn',
    images: ['forticlient.exe', 'fortitray.exe'],
  },
  {
    id: 'globalprotect',
    name: 'GlobalProtect',
    category: 'vpn',
    images: ['pangpa.exe'],
    services: ['pangps.exe'],
  },

  // --- Proxy clients: system proxy, their own TUN, or per-app redirection --
  {
    id: 'v2rayn',
    name: 'v2rayN',
    category: 'proxy',
    images: ['v2rayn.exe'],
  },
  {
    id: 'nekoray',
    name: 'NekoRay / NekoBox',
    category: 'proxy',
    images: ['nekoray.exe', 'nekobox.exe', 'nekobox_core.exe'],
  },
  {
    id: 'throne',
    name: 'Throne',
    category: 'proxy',
    images: ['throne.exe'],
  },
  {
    id: 'v2raytun',
    name: 'v2RayTun',
    category: 'proxy',
    // GUI plus the cores it ships under data\flutter_assets\assets\data:
    // xray\xraycore.exe and singbox\libhost.exe (started while connected).
    images: ['v2raytun.exe', 'xraycore.exe', 'libhost.exe'],
  },
  {
    id: 'hiddify',
    name: 'Hiddify',
    category: 'proxy',
    images: ['hiddify.exe', 'hiddifycli.exe', 'hiddify-cli.exe'],
  },
  {
    id: 'clash',
    name: 'Clash / Clash Verge / Mihomo Party',
    category: 'proxy',
    images: [
      'clash for windows.exe',
      'clash-verge.exe',
      'clash verge.exe',
      'verge-mihomo.exe',
      'verge-mihomo-alpha.exe',
      'mihomo-party.exe',
    ],
    services: ['clash-verge-service.exe'],
  },
  {
    id: 'flclash',
    name: 'FlClash',
    category: 'proxy',
    images: ['flclash.exe', 'flclashcore.exe'],
  },
  {
    id: 'karing',
    name: 'Karing',
    category: 'proxy',
    images: ['karing.exe'],
  },
  {
    id: 'happ',
    name: 'Happ',
    category: 'proxy',
    images: ['happ.exe'],
  },
  {
    id: 'qv2ray',
    name: 'Qv2ray',
    category: 'proxy',
    images: ['qv2ray.exe'],
  },
  {
    id: 'v2raya',
    name: 'v2rayA',
    category: 'proxy',
    images: [],
    services: ['v2raya.exe'],
  },
  {
    id: 'shadowsocks',
    name: 'Shadowsocks',
    category: 'proxy',
    images: ['shadowsocks.exe'],
  },
  {
    id: 'proxifier',
    name: 'Proxifier',
    category: 'proxy',
    // Redirects other processes' sockets — including xray.exe's own dials.
    images: ['proxifier.exe'],
  },

  // --- DPI bypass via WinDivert: rewrites packets of every process ---------
  {
    id: 'zapret',
    name: 'zapret (winws)',
    category: 'dpi',
    images: ['winws.exe'],
  },
  {
    id: 'goodbyedpi',
    name: 'GoodbyeDPI',
    category: 'dpi',
    images: ['goodbyedpi.exe'],
  },
  {
    id: 'byedpi',
    name: 'ByeDPI',
    category: 'dpi',
    images: ['ciadpi.exe'],
  },
  {
    id: 'spoofdpi',
    name: 'SpoofDPI',
    category: 'dpi',
    images: ['spoofdpi.exe'],
  },

  // --- Proxy cores left running by another client ---------------------------
  {
    id: 'core-xray',
    name: 'Xray',
    category: 'core',
    images: ['xray.exe', 'v2ray.exe'],
  },
  {
    id: 'core-singbox',
    name: 'sing-box',
    category: 'core',
    images: ['sing-box.exe'],
  },
  {
    id: 'core-mihomo',
    name: 'Mihomo / Clash',
    category: 'core',
    images: ['mihomo.exe', 'clash.exe', 'clash-meta.exe'],
  },
  {
    id: 'core-tun2socks',
    name: 'tun2socks',
    category: 'core',
    images: ['tun2socks.exe'],
  },
  {
    id: 'core-hysteria',
    name: 'Hysteria',
    category: 'core',
    images: ['hysteria.exe'],
  },
];
