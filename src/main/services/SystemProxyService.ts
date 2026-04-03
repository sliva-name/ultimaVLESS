import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import { logger } from './LoggerService';

const PROXY_SCRIPT = `
param($enable, $proxy)
$reg = "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings"
try {
    if ($enable -eq "1") {
        Set-ItemProperty -Path $reg -Name ProxyEnable -Value 1
        Set-ItemProperty -Path $reg -Name ProxyServer -Value $proxy
        Write-Host "Proxy enabled: $proxy"
    } else {
        Set-ItemProperty -Path $reg -Name ProxyEnable -Value 0
        Write-Host "Proxy disabled"
    }
    
    $codes = @"
    using System;
    using System.Runtime.InteropServices;
    public class InternetSettings {
        [DllImport("wininet.dll")]
        public static extern bool InternetSetOption(IntPtr hInternet, int dwOption, IntPtr lpBuffer, int dwBufferLength);
        public const int INTERNET_OPTION_SETTINGS_CHANGED = 39;
        public const int INTERNET_OPTION_REFRESH = 37;
        public static void Refresh() {
            InternetSetOption(IntPtr.Zero, INTERNET_OPTION_SETTINGS_CHANGED, IntPtr.Zero, 0);
            InternetSetOption(IntPtr.Zero, INTERNET_OPTION_REFRESH, IntPtr.Zero, 0);
        }
    }
"@
    Add-Type -TypeDefinition $codes
    [InternetSettings]::Refresh()
} catch {
    Write-Error $_
}
`;

interface WindowsProxySnapshot {
  platform: 'win32';
  proxyEnable: number;
  proxyServer: string | null;
  proxyOverride: string | null;
  autoConfigUrl: string | null;
  autoDetect: number;
}

interface MacosServiceProxySnapshot {
  service: string;
  webEnabled: boolean;
  webHost: string | null;
  webPort: number | null;
  secureEnabled: boolean;
  secureHost: string | null;
  securePort: number | null;
  socksEnabled: boolean;
  socksHost: string | null;
  socksPort: number | null;
}

interface MacosProxySnapshot {
  platform: 'darwin';
  services: MacosServiceProxySnapshot[];
}

interface LinuxProxySnapshot {
  platform: 'linux';
  backend: 'gsettings' | 'unsupported';
  mode: string;
  httpHost: string;
  httpPort: number;
  httpsHost: string;
  httpsPort: number;
  socksHost: string;
  socksPort: number;
}

type ProxySnapshot = WindowsProxySnapshot | MacosProxySnapshot | LinuxProxySnapshot;

/**
 * Service for managing Windows system proxy settings.
 * Uses a PowerShell script with C# interop to ensure settings are applied immediately.
 */
export class SystemProxyService {
  private scriptPath: string;
  private snapshotPath: string;
  private readonly SCRIPT_TIMEOUT_MS = 10000;
  private readonly MACOS_TIMEOUT_MS = 15000;
  private readonly LINUX_TIMEOUT_MS = 8000;
  private activeSnapshot: ProxySnapshot | null = null;
  private readonly platform: NodeJS.Platform;
  private linuxProxyBackend: 'gsettings' | 'unsupported' | null = null;

  constructor(platform: NodeJS.Platform = process.platform) {
    this.platform = platform;
    this.scriptPath = path.join(app.getPath('userData'), 'proxy_manager.ps1');
    this.snapshotPath = path.join(app.getPath('userData'), 'system-proxy-state.json');
    if (this.platform === 'win32') {
      this.initScript();
    }
  }

  /**
   * Initializes the PowerShell script file in the user data directory.
   */
  private initScript() {
    try {
      fs.writeFileSync(this.scriptPath, PROXY_SCRIPT);
    } catch (e) {
      logger.error('SystemProxyService', 'Failed to write proxy script', e);
    }
  }

  /**
   * Enables the system proxy pointing to the specified local ports.
   * 
   * @param {number} httpPort - The HTTP proxy port.
   * @param {number} socksPort - The SOCKS proxy port.
   * @returns {Promise<void>}
   */
  public async enable(httpPort: number, socksPort: number): Promise<void> {
    if (this.platform === 'darwin') {
      await this.ensureSnapshotCaptured();
      await this.enableMacosProxy(httpPort, socksPort);
      return;
    }
    if (this.platform === 'linux') {
      await this.ensureSnapshotCaptured();
      await this.enableLinuxProxy(httpPort, socksPort);
      return;
    }
    if (this.platform !== 'win32') {
      logger.info('SystemProxyService', 'Unsupported platform for system proxy operations', {
        platform: this.platform,
      });
      return;
    }

    await this.ensureSnapshotCaptured();
    // Format: http=127.0.0.1:10809;https=127.0.0.1:10809;socks=127.0.0.1:10808
    const proxyString = `http=127.0.0.1:${httpPort};https=127.0.0.1:${httpPort};socks=127.0.0.1:${socksPort}`;
    await this.runScript('1', proxyString);
  }

  /**
   * Disables the system proxy.
   * @returns {Promise<void>}
   */
  public async disable(): Promise<void> {
    if (this.platform === 'darwin') {
      await this.restoreSnapshotOrFallback(() => this.disableMacosProxy());
      return;
    }
    if (this.platform === 'linux') {
      await this.restoreSnapshotOrFallback(() => this.disableLinuxProxy());
      return;
    }
    if (this.platform !== 'win32') {
      return;
    }
    await this.restoreSnapshotOrFallback(() => this.runScript('0', ''));
  }

  private async enableMacosProxy(httpPort: number, socksPort: number): Promise<void> {
    const services = await this.listMacosNetworkServices();
    if (services.length === 0) {
      throw new Error('No macOS network services found for system proxy configuration.');
    }

    for (const service of services) {
      await this.runCommand('/usr/sbin/networksetup', ['-setwebproxy', service, '127.0.0.1', String(httpPort)], this.MACOS_TIMEOUT_MS);
      await this.runCommand('/usr/sbin/networksetup', ['-setsecurewebproxy', service, '127.0.0.1', String(httpPort)], this.MACOS_TIMEOUT_MS);
      await this.runCommand('/usr/sbin/networksetup', ['-setsocksfirewallproxy', service, '127.0.0.1', String(socksPort)], this.MACOS_TIMEOUT_MS);
      await this.runCommand('/usr/sbin/networksetup', ['-setwebproxystate', service, 'on'], this.MACOS_TIMEOUT_MS);
      await this.runCommand('/usr/sbin/networksetup', ['-setsecurewebproxystate', service, 'on'], this.MACOS_TIMEOUT_MS);
      await this.runCommand('/usr/sbin/networksetup', ['-setsocksfirewallproxystate', service, 'on'], this.MACOS_TIMEOUT_MS);
    }

    logger.info('SystemProxyService', 'macOS system proxy enabled', {
      servicesCount: services.length,
      httpPort,
      socksPort,
    });
  }

  private async disableMacosProxy(): Promise<void> {
    const services = await this.listMacosNetworkServices();
    if (services.length === 0) {
      logger.warn('SystemProxyService', 'No macOS network services found while disabling proxy');
      return;
    }

    for (const service of services) {
      await this.runCommand('/usr/sbin/networksetup', ['-setwebproxystate', service, 'off'], this.MACOS_TIMEOUT_MS);
      await this.runCommand('/usr/sbin/networksetup', ['-setsecurewebproxystate', service, 'off'], this.MACOS_TIMEOUT_MS);
      await this.runCommand('/usr/sbin/networksetup', ['-setsocksfirewallproxystate', service, 'off'], this.MACOS_TIMEOUT_MS);
    }

    logger.info('SystemProxyService', 'macOS system proxy disabled', {
      servicesCount: services.length,
    });
  }

  private async listMacosNetworkServices(): Promise<string[]> {
    const output = await this.runCommand('/usr/sbin/networksetup', ['-listallnetworkservices'], this.MACOS_TIMEOUT_MS);
    return output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .filter((line) => line !== 'An asterisk (*) denotes that a network service is disabled.')
      .map((line) => line.replace(/^\*\s*/, ''));
  }

  private async enableLinuxProxy(httpPort: number, socksPort: number): Promise<void> {
    const backend = await this.getLinuxProxyBackend();
    if (backend !== 'gsettings') {
      throw new Error(this.getLinuxUnsupportedReason());
    }

    try {
      await this.runLinuxGsettingsCommand(['set', 'org.gnome.system.proxy', 'mode', 'manual']);
      await this.runLinuxGsettingsCommand(['set', 'org.gnome.system.proxy.http', 'host', '127.0.0.1']);
      await this.runLinuxGsettingsCommand(['set', 'org.gnome.system.proxy.http', 'port', String(httpPort)]);
      await this.runLinuxGsettingsCommand(['set', 'org.gnome.system.proxy.https', 'host', '127.0.0.1']);
      await this.runLinuxGsettingsCommand(['set', 'org.gnome.system.proxy.https', 'port', String(httpPort)]);
      await this.runLinuxGsettingsCommand(['set', 'org.gnome.system.proxy.socks', 'host', '127.0.0.1']);
      await this.runLinuxGsettingsCommand(['set', 'org.gnome.system.proxy.socks', 'port', String(socksPort)]);
      logger.info('SystemProxyService', 'Linux proxy enabled via gsettings', {
        httpPort,
        socksPort,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to enable Linux system proxy via gsettings: ${message}`);
    }
  }

  private async disableLinuxProxy(): Promise<void> {
    const backend = await this.getLinuxProxyBackend();
    if (backend !== 'gsettings') {
      throw new Error(this.getLinuxUnsupportedReason());
    }

    try {
      await this.runLinuxGsettingsCommand(['set', 'org.gnome.system.proxy', 'mode', 'none']);
      logger.info('SystemProxyService', 'Linux proxy disabled via gsettings');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to disable Linux system proxy via gsettings: ${message}`);
    }
  }

  /**
   * Executes the PowerShell script to apply settings.
   * 
   * @param {string} enable - '1' to enable, '0' to disable.
   * @param {string} proxy - The proxy connection string.
   */
  private runScript(enable: string, proxy: string): Promise<void> {
    return new Promise((resolve, reject) => {
      logger.info('SystemProxyService', `Running script enable=${enable} proxy=${proxy}`);
      
      const ps = spawn('powershell', [
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-File', this.scriptPath,
        enable,
        proxy
      ], { windowsHide: true });

      const timeout = setTimeout(() => {
        ps.kill('SIGTERM');
        reject(new Error(`Proxy script timed out after ${this.SCRIPT_TIMEOUT_MS / 1000}s`));
      }, this.SCRIPT_TIMEOUT_MS);

      ps.stdout.on('data', (data) => {
        logger.info('SystemProxyService', 'STDOUT', { data: data.toString().trim() });
      });

      ps.stderr.on('data', (data) => {
        logger.error('SystemProxyService', 'STDERR', { data: data.toString().trim() });
      });

      ps.on('close', (code) => {
        clearTimeout(timeout);
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Proxy script exited with code ${code}`));
        }
      });

      ps.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  }

  private async ensureSnapshotCaptured(): Promise<void> {
    if (this.activeSnapshot) {
      return;
    }

    const persisted = this.loadSnapshot();
    if (persisted) {
      this.activeSnapshot = persisted;
      return;
    }

    const snapshot = await this.captureCurrentProxyState();
    this.activeSnapshot = snapshot;
    this.saveSnapshot(snapshot);
  }

  private async restoreSnapshotOrFallback(fallback: () => Promise<void>): Promise<void> {
    const snapshot = this.activeSnapshot ?? this.loadSnapshot();
    if (!snapshot) {
      await fallback();
      return;
    }

    await this.restoreProxyState(snapshot);
    this.activeSnapshot = null;
    this.clearSnapshot();
  }

  private async captureCurrentProxyState(): Promise<ProxySnapshot> {
    if (this.platform === 'win32') {
      return this.captureWindowsProxyState();
    }
    if (this.platform === 'darwin') {
      return this.captureMacosProxyState();
    }
    if (this.platform === 'linux') {
      return this.captureLinuxProxyState();
    }
    throw new Error(`Unsupported platform for proxy snapshot: ${this.platform}`);
  }

  private async restoreProxyState(snapshot: ProxySnapshot): Promise<void> {
    if (snapshot.platform === 'win32') {
      await this.restoreWindowsProxyState(snapshot);
      return;
    }
    if (snapshot.platform === 'darwin') {
      await this.restoreMacosProxyState(snapshot);
      return;
    }
    await this.restoreLinuxProxyState(snapshot);
  }

  private loadSnapshot(): ProxySnapshot | null {
    try {
      if (!fs.existsSync(this.snapshotPath)) {
        return null;
      }
      return JSON.parse(fs.readFileSync(this.snapshotPath, 'utf8')) as ProxySnapshot;
    } catch (error) {
      logger.warn('SystemProxyService', 'Failed to load proxy snapshot', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private saveSnapshot(snapshot: ProxySnapshot): void {
    try {
      fs.writeFileSync(this.snapshotPath, JSON.stringify(snapshot, null, 2));
    } catch (error) {
      logger.warn('SystemProxyService', 'Failed to persist proxy snapshot', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private clearSnapshot(): void {
    try {
      if (fs.existsSync(this.snapshotPath)) {
        fs.unlinkSync(this.snapshotPath);
      }
    } catch (error) {
      logger.warn('SystemProxyService', 'Failed to clear proxy snapshot', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async captureWindowsProxyState(): Promise<WindowsProxySnapshot> {
    const output = await this.runPowerShellCommand(`
      $reg = "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings"
      $props = Get-ItemProperty -Path $reg
      [PSCustomObject]@{
        platform = 'win32'
        proxyEnable = [int]($props.ProxyEnable | ForEach-Object { $_ } | Select-Object -First 1)
        proxyServer = if ($null -ne $props.ProxyServer) { [string]$props.ProxyServer } else { $null }
        proxyOverride = if ($null -ne $props.ProxyOverride) { [string]$props.ProxyOverride } else { $null }
        autoConfigUrl = if ($null -ne $props.AutoConfigURL) { [string]$props.AutoConfigURL } else { $null }
        autoDetect = [int]($props.AutoDetect | ForEach-Object { $_ } | Select-Object -First 1)
      } | ConvertTo-Json -Compress
    `);
    return JSON.parse(output.trim()) as WindowsProxySnapshot;
  }

  private async restoreWindowsProxyState(snapshot: WindowsProxySnapshot): Promise<void> {
    const encoded = Buffer.from(JSON.stringify(snapshot), 'utf8').toString('base64');
    await this.runPowerShellCommand(`
      $json = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${encoded}'))
      $state = $json | ConvertFrom-Json
      $reg = "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings"
      Set-ItemProperty -Path $reg -Name ProxyEnable -Value ([int]$state.proxyEnable)
      if ($null -eq $state.proxyServer -or $state.proxyServer -eq '') {
        Remove-ItemProperty -Path $reg -Name ProxyServer -ErrorAction SilentlyContinue
      } else {
        Set-ItemProperty -Path $reg -Name ProxyServer -Value ([string]$state.proxyServer)
      }
      if ($null -eq $state.proxyOverride -or $state.proxyOverride -eq '') {
        Remove-ItemProperty -Path $reg -Name ProxyOverride -ErrorAction SilentlyContinue
      } else {
        Set-ItemProperty -Path $reg -Name ProxyOverride -Value ([string]$state.proxyOverride)
      }
      if ($null -eq $state.autoConfigUrl -or $state.autoConfigUrl -eq '') {
        Remove-ItemProperty -Path $reg -Name AutoConfigURL -ErrorAction SilentlyContinue
      } else {
        Set-ItemProperty -Path $reg -Name AutoConfigURL -Value ([string]$state.autoConfigUrl)
      }
      Set-ItemProperty -Path $reg -Name AutoDetect -Value ([int]$state.autoDetect)
      Add-Type -TypeDefinition @"
      using System;
      using System.Runtime.InteropServices;
      public class InternetSettings {
          [DllImport("wininet.dll")]
          public static extern bool InternetSetOption(IntPtr hInternet, int dwOption, IntPtr lpBuffer, int dwBufferLength);
          public const int INTERNET_OPTION_SETTINGS_CHANGED = 39;
          public const int INTERNET_OPTION_REFRESH = 37;
      }
"@
      [InternetSettings]::InternetSetOption([IntPtr]::Zero, [InternetSettings]::INTERNET_OPTION_SETTINGS_CHANGED, [IntPtr]::Zero, 0) | Out-Null
      [InternetSettings]::InternetSetOption([IntPtr]::Zero, [InternetSettings]::INTERNET_OPTION_REFRESH, [IntPtr]::Zero, 0) | Out-Null
    `);
  }

  private async captureMacosProxyState(): Promise<MacosProxySnapshot> {
    const services = await this.listMacosNetworkServices();
    const snapshots = await Promise.all(
      services.map(async (service) => {
        const [web, secure, socks] = await Promise.all([
          this.getMacosProxyDetails(service, 'web'),
          this.getMacosProxyDetails(service, 'secure'),
          this.getMacosProxyDetails(service, 'socks'),
        ]);
        return {
          service,
          webEnabled: web.enabled,
          webHost: web.host,
          webPort: web.port,
          secureEnabled: secure.enabled,
          secureHost: secure.host,
          securePort: secure.port,
          socksEnabled: socks.enabled,
          socksHost: socks.host,
          socksPort: socks.port,
        } satisfies MacosServiceProxySnapshot;
      })
    );
    return {
      platform: 'darwin',
      services: snapshots,
    };
  }

  private async restoreMacosProxyState(snapshot: MacosProxySnapshot): Promise<void> {
    for (const service of snapshot.services) {
      await this.restoreMacosProxyKind(service.service, 'web', service.webHost, service.webPort, service.webEnabled);
      await this.restoreMacosProxyKind(service.service, 'secure', service.secureHost, service.securePort, service.secureEnabled);
      await this.restoreMacosProxyKind(service.service, 'socks', service.socksHost, service.socksPort, service.socksEnabled);
    }
  }

  private async captureLinuxProxyState(): Promise<LinuxProxySnapshot> {
    const backend = await this.getLinuxProxyBackend();
    if (backend !== 'gsettings') {
      return {
        platform: 'linux',
        backend: 'unsupported',
        mode: 'none',
        httpHost: '',
        httpPort: 0,
        httpsHost: '',
        httpsPort: 0,
        socksHost: '',
        socksPort: 0,
      };
    }

    const [mode, httpHost, httpPort, httpsHost, httpsPort, socksHost, socksPort] = await Promise.all([
      this.runLinuxGsettingsCommand(['get', 'org.gnome.system.proxy', 'mode']),
      this.runLinuxGsettingsCommand(['get', 'org.gnome.system.proxy.http', 'host']),
      this.runLinuxGsettingsCommand(['get', 'org.gnome.system.proxy.http', 'port']),
      this.runLinuxGsettingsCommand(['get', 'org.gnome.system.proxy.https', 'host']),
      this.runLinuxGsettingsCommand(['get', 'org.gnome.system.proxy.https', 'port']),
      this.runLinuxGsettingsCommand(['get', 'org.gnome.system.proxy.socks', 'host']),
      this.runLinuxGsettingsCommand(['get', 'org.gnome.system.proxy.socks', 'port']),
    ]);
    return {
      platform: 'linux',
      backend,
      mode: this.parseGsettingsString(mode),
      httpHost: this.parseGsettingsString(httpHost),
      httpPort: this.parseGsettingsNumber(httpPort),
      httpsHost: this.parseGsettingsString(httpsHost),
      httpsPort: this.parseGsettingsNumber(httpsPort),
      socksHost: this.parseGsettingsString(socksHost),
      socksPort: this.parseGsettingsNumber(socksPort),
    };
  }

  private async restoreLinuxProxyState(snapshot: LinuxProxySnapshot): Promise<void> {
    if (snapshot.backend === 'unsupported') {
      logger.warn('SystemProxyService', 'Skipping Linux proxy restore because original backend was unsupported');
      return;
    }

    await this.runLinuxGsettingsCommand(['set', 'org.gnome.system.proxy.http', 'host', snapshot.httpHost]);
    await this.runLinuxGsettingsCommand(['set', 'org.gnome.system.proxy.http', 'port', String(snapshot.httpPort)]);
    await this.runLinuxGsettingsCommand(['set', 'org.gnome.system.proxy.https', 'host', snapshot.httpsHost]);
    await this.runLinuxGsettingsCommand(['set', 'org.gnome.system.proxy.https', 'port', String(snapshot.httpsPort)]);
    await this.runLinuxGsettingsCommand(['set', 'org.gnome.system.proxy.socks', 'host', snapshot.socksHost]);
    await this.runLinuxGsettingsCommand(['set', 'org.gnome.system.proxy.socks', 'port', String(snapshot.socksPort)]);
    await this.runLinuxGsettingsCommand(['set', 'org.gnome.system.proxy', 'mode', snapshot.mode]);
  }

  private async getMacosProxyDetails(service: string, kind: 'web' | 'secure' | 'socks'): Promise<{ enabled: boolean; host: string | null; port: number | null }> {
    const args =
      kind === 'web'
        ? ['-getwebproxy', service]
        : kind === 'secure'
          ? ['-getsecurewebproxy', service]
          : ['-getsocksfirewallproxy', service];
    const output = await this.runCommand('/usr/sbin/networksetup', args, this.MACOS_TIMEOUT_MS);
    return this.parseMacosProxyDetails(output);
  }

  private parseMacosProxyDetails(output: string): { enabled: boolean; host: string | null; port: number | null } {
    const enabled = /^\s*Enabled:\s+Yes\s*$/im.test(output);
    const serverMatch = /^\s*Server:\s+(.+)\s*$/im.exec(output);
    const portMatch = /^\s*Port:\s+(\d+)\s*$/im.exec(output);
    return {
      enabled,
      host: serverMatch ? serverMatch[1].trim() : null,
      port: portMatch ? Number(portMatch[1]) : null,
    };
  }

  private async restoreMacosProxyKind(
    service: string,
    kind: 'web' | 'secure' | 'socks',
    host: string | null,
    port: number | null,
    enabled: boolean
  ): Promise<void> {
    const setArgs =
      kind === 'web'
        ? ['-setwebproxy', service]
        : kind === 'secure'
          ? ['-setsecurewebproxy', service]
          : ['-setsocksfirewallproxy', service];
    const stateArgs =
      kind === 'web'
        ? ['-setwebproxystate', service, enabled ? 'on' : 'off']
        : kind === 'secure'
          ? ['-setsecurewebproxystate', service, enabled ? 'on' : 'off']
          : ['-setsocksfirewallproxystate', service, enabled ? 'on' : 'off'];

    if (host && port != null) {
      await this.runCommand('/usr/sbin/networksetup', [...setArgs, host, String(port)], this.MACOS_TIMEOUT_MS);
    }
    await this.runCommand('/usr/sbin/networksetup', stateArgs, this.MACOS_TIMEOUT_MS);
  }

  private parseGsettingsString(raw: string): string {
    return raw.trim().replace(/^'/, '').replace(/'$/, '');
  }

  private parseGsettingsNumber(raw: string): number {
    const parsed = Number(raw.trim());
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private async getLinuxProxyBackend(): Promise<'gsettings' | 'unsupported'> {
    if (this.linuxProxyBackend) {
      return this.linuxProxyBackend;
    }

    try {
      await this.runCommand('gsettings', ['writable', 'org.gnome.system.proxy', 'mode'], this.LINUX_TIMEOUT_MS);
      this.linuxProxyBackend = 'gsettings';
    } catch (error) {
      logger.warn('SystemProxyService', 'Linux proxy backend is unsupported', {
        error: error instanceof Error ? error.message : String(error),
        desktop: process.env.XDG_CURRENT_DESKTOP || process.env.DESKTOP_SESSION || 'unknown',
      });
      this.linuxProxyBackend = 'unsupported';
    }

    return this.linuxProxyBackend;
  }

  private getLinuxUnsupportedReason(): string {
    return 'Linux system proxy control currently requires a GNOME-compatible desktop with gsettings available.';
  }

  private runLinuxGsettingsCommand(args: string[]): Promise<string> {
    return this.runCommand('gsettings', args, this.LINUX_TIMEOUT_MS);
  }

  private runPowerShellCommand(script: string): Promise<string> {
    return this.runCommand(
      'powershell',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
      this.SCRIPT_TIMEOUT_MS
    );
  }

  private runCommand(command: string, args: string[], timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { windowsHide: true });
      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`${command} timed out after ${Math.floor(timeoutMs / 1000)}s`));
      }, timeoutMs);

      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      child.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.on('close', (code) => {
        clearTimeout(timeout);
        if (code === 0) {
          resolve(stdout);
          return;
        }
        const details = `${stderr}\n${stdout}`.trim() || `${command} exited with code ${code}`;
        reject(new Error(details));
      });
    });
  }
}

export const systemProxyService = new SystemProxyService();
