# Ultima VLESS Client

[![Русский](https://img.shields.io/badge/🇷🇺_Русский-lightgrey)](README.md)
[![English](https://img.shields.io/badge/🇬🇧_English-green)](README_EN.md)

[![GitHub stars](https://img.shields.io/github/stars/sliva-name/ultimaVLESS?style=for-the-badge)](https://github.com/sliva-name/ultimaVLESS/stargazers)
[![GitHub downloads](https://img.shields.io/github/downloads/sliva-name/ultimaVLESS/total?style=for-the-badge)](https://github.com/sliva-name/ultimaVLESS/releases)
[![Visits](https://hits.sh/github.com/sliva-name/ultimaVLESS.svg?style=for-the-badge&label=visits)](https://hits.sh/github.com/sliva-name/ultimaVLESS/)

**Ultima VLESS Client** is a free desktop VPN client powered by Xray. It features a simple interface, subscription imports, and two connection modes: system proxy and TUN.

The primary platform is **Windows**. Versions for macOS and Linux are also available, but some features may work differently or have limitations on these platforms.

## Download and Installation

1. Open the [latest release](https://github.com/sliva-name/ultimaVLESS/releases/latest).
2. Download the file for your operating system:
   - **Windows** — installer (`UltimaVLESS-Setup-*.exe`) or portable version (`UltimaVLESS-Portable-*.exe`)
   - **macOS** — `.dmg` or `.zip`
   - **Linux** — `.AppImage` or `.deb`
3. Install or launch the application.
4. Open **UltimaVLESS**.

## Supported Protocols

| Protocol | How to Add |
| --- | --- |
| **VLESS** (including Reality and Vision) | `vless://` link, text subscription, or JSON subscription |
| **Trojan** | `trojan://` link, text subscription, or JSON subscription |
| **Shadowsocks** | `ss://` link, text subscription, or JSON subscription |
| **Hysteria 2** | `hy2://` / `hysteria2://` link or JSON subscription |
| **WireGuard** | JSON subscription only (ready-to-use Xray outbound) |
| **VMess** | JSON subscription only (ready-to-use Xray configuration) |

Reality and Vision are not separate protocols; they are VLESS configuration options.

**Not supported:** TUIC, `vmess://` links, and other protocols outside the Xray ecosystem.

## Features

- Import server lists using a **subscription URL** (text, Base64, or JSON).
- **Manually add servers** by pasting text containing `vless://`, `trojan://`, `ss://`, `hy2://`, or `hysteria2://` links.
- Separate server lists for **Subscriptions** and **Manual** entries.
- Two connection modes:
  - **Proxy** — traffic is routed through a local proxy. System settings are restored when disconnected.
  - **TUN** — all traffic is routed through a virtual network adapter (UAC confirmation may be required on Windows).
- **Routing rules (split tunneling)**: route all traffic through the VPN with exceptions, route only selected websites through the VPN, or route only selected applications through the VPN. You can also specify applications that should always bypass the VPN. See [docs/routing-rules.md](docs/routing-rules.md) for details.
- **Server ping** — check individual servers or update latency for all servers. By default, the client uses **real latency**: an HTTP request is sent through each server, just like in v2rayN. This ensures that a server that responds but cannot actually route traffic is not incorrectly marked as working. Fast TCP ping can be enabled under **Settings → Network**.
- **Automatic subscription updates** — refresh server lists from subscriptions.
- **Automatic server switching** — switch to another server if the current one stops responding.
- Display of **connection status**, errors, and **session traffic statistics**.
- **Automatic application updates** via GitHub.
- **System tray icon** — minimize the application to the background and quickly reopen its window.
- Interface available in **Russian** and **English**.

## Quick Start

1. Click **Settings** (the gear icon in the sidebar).
2. Open the **Sources** tab and add a subscription URL or paste server links manually.
3. Select a server from the list on the left.
4. Open the **Network** tab and choose a connection mode — **Proxy** or **TUN**.
5. Click **Connect**.

To switch servers, **disconnect first**, then select another server and connect again.

## Settings

| Tab | Description |
| --- | --- |
| **Sources** | Subscriptions, manual links, and importing the built-in server list |
| **Network** | Connection mode (Proxy / TUN), [routing rules](docs/routing-rules.md), and additional options |
| **Diagnostics** | Automatic server switching, blocked servers, and log copying |

You can switch the interface language using the **RU** / **EN** buttons in the header of the Settings window.

## Connection Modes

**Proxy** — suitable for most users. Does not require administrator privileges. Browsers and many applications automatically use the system proxy settings.

**TUN** — intercepts all network traffic. On **Windows**, the first connection may trigger a UAC prompt (Run as administrator). TUN mode is not available on **macOS** — use Proxy mode instead.

## Built-in Default Subscription

The application allows you to import a ready-made server list (Mobile White List) with a single click.

The button is located under **Settings → Sources**.

## Troubleshooting

| Problem | What to Try |
| --- | --- |
| TUN requests administrator privileges | This is normal on Windows. Confirm the UAC prompt or switch to **Proxy** mode. |
| TUN fails to start until unnecessary network adapters are disabled (Windows) | Go to **Settings → Network → TUN Network Adapter**. Select the adapter actually used for your internet connection (usually Wi-Fi or your primary Ethernet adapter), save the settings, and reconnect. |
| Another VPN, proxy client, or DPI bypass tool is running (Windows) | When connecting in TUN mode, UltimaVLESS displays detected applications in the **Diagnostics** tab. Close them using the **Close** button and reconnect. Services (WireGuard, NordVPN, etc.) are not stopped automatically — disconnect the VPN in the corresponding application. |
| Servers failed to load | Check the subscription URL in your browser and make sure you have an active internet connection. |
| Ping is not displayed | The real latency check failed: no traffic is currently passing through the server (the server is unavailable or blocked by your ISP). Select a server with a displayed latency. |
| Need help | Open **Settings → Diagnostics** and copy the logs or open the log folder. |

## Android

The [`mobile/`](mobile/README.md) directory contains the Android version, featuring the same interface and connection logic: subscriptions, manual links, automatic server switching, ping, and routing rules.

TUN mode is called **VPN** on Android and uses the system `VpnService`.

The **Proxy Only** mode opens local SOCKS5/HTTP proxies, while applications for routing rules are selected from the installed apps.

The Android version also supports a Quick Settings tile and Always-on VPN.

Currently, the APK must be built from source. See the instructions in [mobile/README.md](mobile/README.md).

## License

MIT — the application is free and open-source.
