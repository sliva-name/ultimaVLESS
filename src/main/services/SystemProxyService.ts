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

/**
 * Service for managing Windows system proxy settings.
 * Uses a PowerShell script with C# interop to ensure settings are applied immediately.
 */
export class SystemProxyService {
  private scriptPath: string;
  private readonly SCRIPT_TIMEOUT_MS = 10000;
  private readonly MACOS_TIMEOUT_MS = 15000;
  private readonly LINUX_TIMEOUT_MS = 8000;

  constructor() {
    this.scriptPath = path.join(app.getPath('userData'), 'proxy_manager.ps1');
    if (process.platform === 'win32') {
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
    if (process.platform === 'darwin') {
      await this.enableMacosProxy(httpPort, socksPort);
      return;
    }
    if (process.platform === 'linux') {
      await this.enableLinuxProxy(httpPort, socksPort);
      return;
    }
    if (process.platform !== 'win32') {
      logger.info('SystemProxyService', 'Unsupported platform for system proxy operations', {
        platform: process.platform,
      });
      return;
    }

    // Format: http=127.0.0.1:10809;https=127.0.0.1:10809;socks=127.0.0.1:10808
    const proxyString = `http=127.0.0.1:${httpPort};https=127.0.0.1:${httpPort};socks=127.0.0.1:${socksPort}`;
    await this.runScript('1', proxyString);
  }

  /**
   * Disables the system proxy.
   * @returns {Promise<void>}
   */
  public async disable(): Promise<void> {
    if (process.platform === 'darwin') {
      await this.disableMacosProxy();
      return;
    }
    if (process.platform === 'linux') {
      await this.disableLinuxProxy();
      return;
    }
    if (process.platform !== 'win32') {
      return;
    }
    await this.runScript('0', '');
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
    try {
      await this.runCommand('gsettings', ['set', 'org.gnome.system.proxy', 'mode', 'manual'], this.LINUX_TIMEOUT_MS);
      await this.runCommand('gsettings', ['set', 'org.gnome.system.proxy.http', 'host', '127.0.0.1'], this.LINUX_TIMEOUT_MS);
      await this.runCommand('gsettings', ['set', 'org.gnome.system.proxy.http', 'port', String(httpPort)], this.LINUX_TIMEOUT_MS);
      await this.runCommand('gsettings', ['set', 'org.gnome.system.proxy.https', 'host', '127.0.0.1'], this.LINUX_TIMEOUT_MS);
      await this.runCommand('gsettings', ['set', 'org.gnome.system.proxy.https', 'port', String(httpPort)], this.LINUX_TIMEOUT_MS);
      await this.runCommand('gsettings', ['set', 'org.gnome.system.proxy.socks', 'host', '127.0.0.1'], this.LINUX_TIMEOUT_MS);
      await this.runCommand('gsettings', ['set', 'org.gnome.system.proxy.socks', 'port', String(socksPort)], this.LINUX_TIMEOUT_MS);
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
    try {
      await this.runCommand('gsettings', ['set', 'org.gnome.system.proxy', 'mode', 'none'], this.LINUX_TIMEOUT_MS);
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
