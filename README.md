# Ultima VLESS Client

[![GitHub stars](https://img.shields.io/github/stars/sliva-name/ultimaVLESS?style=for-the-badge)](https://github.com/sliva-name/ultimaVLESS/stargazers)
[![GitHub downloads](https://img.shields.io/github/downloads/sliva-name/ultimaVLESS/total?style=for-the-badge)](https://github.com/sliva-name/ultimaVLESS/releases)
[![Visits](https://hits.sh/github.com/sliva-name/ultimaVLESS.svg?style=for-the-badge&label=visits)](https://hits.sh/github.com/sliva-name/ultimaVLESS/)

Ultima VLESS Client is an open-source desktop VLESS/Xray VPN client with a simple interface, fast connection flow, and support for modern Xray-based configurations.
Windows is the primary supported platform. macOS/Linux support is available and currently experimental.

## Why Ultima VLESS Client

Ultima VLESS Client is designed for users who need a lightweight desktop VPN client for VLESS, Reality, Vision, and Xray configs without extra setup complexity. It works well as a Windows VLESS client, a simple Xray desktop app, and a subscription-friendly VPN client for daily use.

## Download And Install

1. Open the [latest release](https://github.com/sliva-name/ultimaVLESS/releases/latest).
2. Download the package for your OS (`*.exe`, `*.dmg`, `*.AppImage`/`*.deb`).
3. Install/run the package.
4. Launch the app.

Portable build (`UltimaVLESS-Portable-*.exe`) is also available.

## What The App Can Do

- Connect to VLESS servers (including Reality / Vision presets).
- Import and update server lists from subscription links.
- Add manual links from clipboard/text (supports mixed text with `vless://`, `trojan://`, `hysteria2://` links).
- Split servers by source (Subscription / Manual) for easier navigation.
- Work in system proxy mode and TUN mode.
- Save selected server and connection mode between launches.
- Auto-refresh server subscriptions on a timer.
- Show server latency (ping) in the server list.
- Refresh ping for all servers on demand.
- Show connection progress, errors, and current active server.
- Auto-switch to another server when the current one appears blocked.
- Show blocked servers list and allow clearing it in settings.
- Copy application logs and open log folder for troubleshooting.

## Keywords

VLESS client, Xray client, desktop VPN client, Windows VPN client, Reality client, Vision client, V2Ray alternative, Electron VPN app, subscription VPN client, proxy and TUN mode client

## Default Subscription Source

Built-in default subscription URL:

`https://raw.githubusercontent.com/igareck/vpn-configs-for-russia/refs/heads/main/WHITE-CIDR-RU-all.txt`

## Basic Usage

1. Open **Settings** and add your subscription link (or manual config links).
2. Select a server from the list.
3. Choose connection mode (`proxy` or `tun`).
4. Click **Connect**.
5. To switch server, disconnect first, then connect to another server.

## License

MIT
