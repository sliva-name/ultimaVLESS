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

  constructor() {
    this.scriptPath = path.join(app.getPath('userData'), 'proxy_manager.ps1');
    this.initScript();
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
    if (process.platform !== 'win32') {
      logger.info('SystemProxyService', 'Not on Windows, skipping system proxy set');
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
    if (process.platform !== 'win32') return;
    await this.runScript('0', '');
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
        `"${proxy}"` // Quote the proxy string to handle semicolons
      ]);

      ps.stdout.on('data', (data) => {
        logger.info('SystemProxyService', 'STDOUT', { data: data.toString().trim() });
      });

      ps.stderr.on('data', (data) => {
        logger.error('SystemProxyService', 'STDERR', { data: data.toString().trim() });
      });

      ps.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Proxy script exited with code ${code}`));
        }
      });
    });
  }
}

export const systemProxyService = new SystemProxyService();
