import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { logger } from '@/main/services/LoggerService';
import { runCommand } from './runCommand';
import { WindowsProxySnapshot } from './types';

const PROXY_SCRIPT = `
param($enable, $proxy)
$ErrorActionPreference = "Stop"
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
    exit 1
}
exit 0
`;

const SCRIPT_TIMEOUT_MS = 10000;

export class WindowsProxyAdapter {
  private readonly scriptPath: string;

  constructor(userDataDir: string) {
    this.scriptPath = path.join(userDataDir, 'proxy_manager.ps1');
    this.ensureScriptFile();
  }

  private ensureScriptFile(): void {
    try {
      fs.writeFileSync(this.scriptPath, PROXY_SCRIPT);
    } catch (e) {
      logger.error('SystemProxyService', 'Failed to write proxy script', e);
    }
  }

  async captureState(): Promise<WindowsProxySnapshot> {
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

  async enable(httpPort: number, socksPort: number): Promise<void> {
    const proxyString = `http=127.0.0.1:${httpPort};https=127.0.0.1:${httpPort};socks=127.0.0.1:${socksPort}`;
    await this.runScript('1', proxyString);
  }

  async disableRaw(): Promise<void> {
    await this.runScript('0', '');
  }

  async restoreState(snapshot: WindowsProxySnapshot): Promise<void> {
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

  private runScript(enable: string, proxy: string): Promise<void> {
    return new Promise((resolve, reject) => {
      logger.info('SystemProxyService', `Running script enable=${enable} proxy=${proxy}`);

      const ps = spawn('powershell', [
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-File', this.scriptPath,
        enable,
        proxy,
      ], { windowsHide: true });

      const timeout = setTimeout(() => {
        ps.kill('SIGTERM');
        reject(new Error(`Proxy script timed out after ${SCRIPT_TIMEOUT_MS / 1000}s`));
      }, SCRIPT_TIMEOUT_MS);

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

  private runPowerShellCommand(script: string): Promise<string> {
    return runCommand(
      'powershell',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
      SCRIPT_TIMEOUT_MS
    );
  }
}
