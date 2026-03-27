# Ultima VLESS Client

Ultima VLESS Client is a desktop VPN app for Windows with a simple interface, fast connection flow, and support for modern Xray/VLESS configurations.

## Download And Install

1. Open the [latest release](https://github.com/sliva-name/ultimaVLESS/releases/latest).
2. Download `UltimaVLESS-Setup-*.exe`.
3. Run the installer.
4. Launch the app from the desktop or Start Menu.

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
