# Ultima VLESS Client

A modern, secure, and fast desktop VPN client for Windows, built with Electron, React, and Xray-core.

## 🚀 Features

- **Protocol Support:** VLESS (TCP, WS, gRPC, XTLS-Vision, REALITY).
- **Subscription Support:** Import servers via standard `vless://` links (Base64 encoded subscriptions).
- **System Proxy Integration:** Automatically configures Windows system proxy (HTTP/Socks5) upon connection.
- **Modern UI:** Clean, dark-themed interface built with React and TailwindCSS.
- **Security:**
  - Secure IPC communication between Renderer and Main process.
  - No remote code execution vulnerabilities (nodeIntegration: false).
  - Configurable fingerprinting (uTLS) to evade detection.

## 🛠 Tech Stack

- **Framework:** Electron (with `electron-vite`)
- **Frontend:** React, TypeScript, TailwindCSS
- **Core:** Xray-core (Project X)
- **State Management:** React Hooks + Electron Store
- **Testing:** Vitest + React Testing Library

## 📦 Architecture

The application follows a modular Service-Oriented Architecture (SOA) adapted for Electron:

### Main Process (`src/main/`)
- **`services/XrayService.ts`**: Manages the Xray-core child process (spawn, kill, logs).
- **`services/ConfigGenerator.ts`**: Generates `config.json` for Xray based on strict types.
- **`services/SubscriptionService.ts`**: Fetches and parses Base64 subscription URLs.
- **`services/SystemProxyService.ts`**: PowerShell-based service to safely toggle Windows Registry proxy settings.
- **`services/LoggerService.ts`**: Centralized file logger (`debug_local.log`).
- **`ipc/IpcHandler.ts`**: Handles all IPC events from the renderer.

### Renderer Process (`src/renderer/`)
- **`components/`**: Atomic UI components (Sidebar, ConnectionStatus, etc.).
- **`hooks/useServerState.ts`**: Custom hook encapsulating server selection and connection logic.

## 🏁 Getting Started

### Prerequisites
- Node.js 18+
- Windows 10/11 (for system proxy support)

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/your-repo/ultima-vless-client.git
   cd ultima-vless-client
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Setup Xray Core:**
   - Download `Xray-windows-64.zip` from [Xray-core Releases](https://github.com/XTLS/Xray-core/releases/latest).
   - Create `resources/bin/` in the project root.
   - Extract `xray.exe`, `geoip.dat`, and `geosite.dat` into `resources/bin/`.

4. **Run in Development Mode:**
   ```bash
   npm run dev
   ```

### Building for Production
```bash
npm run build
```
The installer will be generated in `dist/`.

## 🧪 Testing

Run the test suite (Unit + Component tests):
```bash
npm test
```

## 📝 License
MIT
