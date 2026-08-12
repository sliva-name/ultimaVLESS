import path from 'path';
import { logger } from '@/main/services/LoggerService';
import { powerShellPath } from '@/main/services/platform/systemBinaries';
import { removeFileSync } from '@/main/utils/removeFile';
import { runCommand } from './runCommand';
import { WindowsProxySnapshot } from './types';

const SCRIPT_TIMEOUT_MS = 10000;

/**
 * Destinations that must keep working while the proxy is on: loopback, RFC1918,
 * link-local and dotless intranet names. WinINET only understands wildcards, so
 * the 172.16/12 block has to be spelled out. This replaces whatever bypass list
 * the user or a group policy had configured — leaving that list in place would
 * silently send matching (possibly public) domains outside the tunnel.
 */
function buildProxyBypassList(): string {
  const entries = [
    'localhost',
    '127.*',
    '10.*',
    '192.168.*',
    '169.254.*',
    ...Array.from({ length: 16 }, (_, i) => `172.${16 + i}.*`),
    '<local>',
  ];
  return entries.join(';');
}

const WININET_REFRESH_SNIPPET = `
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
`;

const WINHTTP_LOCALHOST_RESET_SNIPPET = `
function Disable-LocalhostWinHttpProxyFallback {
  try {
    $output = (& "$env:SystemRoot\\System32\\netsh.exe" winhttp dump 2>&1 | Out-String)
    if ($LASTEXITCODE -ne 0) {
      Write-Host "WinHTTP proxy inspection skipped: $output"
      return
    }
    $proxyServer = $null
    if ($output -match 'proxy-server="([^"]*)"') {
      $proxyServer = $Matches[1]
    }
    if ($proxyServer -match '(?i)(127\\.0\\.0\\.1|localhost|\\[::1\\])') {
      & "$env:SystemRoot\\System32\\netsh.exe" winhttp reset proxy | Out-Null
      if ($LASTEXITCODE -eq 0) {
        Write-Host "WinHTTP localhost proxy reset"
      } else {
        Write-Host "WinHTTP proxy reset skipped: exit code $LASTEXITCODE"
      }
    }
  } catch {
    Write-Host "WinHTTP proxy cleanup skipped: $_"
  }
}
`;

export class WindowsProxyAdapter {
  constructor(userDataDir: string) {
    this.removeLegacyScriptFile(userDataDir);
  }

  /**
   * Earlier builds wrote `proxy_manager.ps1` into the user-writable data dir and
   * ran it with `powershell -File`. Because the proxy is also torn down from the
   * elevated TUN session, anyone able to write that file could have executed code
   * as Administrator. Scripts are now passed via `-EncodedCommand`; delete the
   * leftover so the old path cannot be reused.
   */
  private removeLegacyScriptFile(userDataDir: string): void {
    const legacyPath = path.join(userDataDir, 'proxy_manager.ps1');
    try {
      removeFileSync(legacyPath);
    } catch (e) {
      logger.warn(
        'SystemProxyService',
        'Could not remove the legacy proxy script',
        e,
      );
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
    assertPort(httpPort);
    assertPort(socksPort);
    const proxyString = `http=127.0.0.1:${httpPort};https=127.0.0.1:${httpPort};socks=127.0.0.1:${socksPort}`;

    // AutoConfigURL (PAC) and AutoDetect (WPAD) take precedence over
    // ProxyServer in WinINET, so an inherited PAC file would keep deciding the
    // route for every request while the UI reports a working proxy. Both are
    // cleared here and restored from the snapshot on disable.
    await this.runPowerShellScript(`
      $ErrorActionPreference = 'Stop'
      $reg = "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings"
      Set-ItemProperty -Path $reg -Name ProxyServer -Value '${proxyString}'
      Set-ItemProperty -Path $reg -Name ProxyOverride -Value '${buildProxyBypassList()}'
      Remove-ItemProperty -Path $reg -Name AutoConfigURL -ErrorAction SilentlyContinue
      Set-ItemProperty -Path $reg -Name AutoDetect -Value 0
      Set-ItemProperty -Path $reg -Name ProxyEnable -Value 1
      ${WININET_REFRESH_SNIPPET}
      Write-Host "Proxy enabled"
    `);
  }

  /**
   * Last-resort teardown when no snapshot survived (crash, or a TUN session that
   * never enabled a proxy). It only touches settings that point at our own
   * loopback listeners, so an unrelated corporate proxy is left alone instead of
   * being switched off — losing that config can cut the user off the network.
   */
  async disableRaw(httpPort: number, socksPort: number): Promise<void> {
    assertPort(httpPort);
    assertPort(socksPort);
    await this.runPowerShellScript(`
      $ErrorActionPreference = 'Stop'
      ${WINHTTP_LOCALHOST_RESET_SNIPPET}
      $reg = "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings"
      $props = Get-ItemProperty -Path $reg -ErrorAction SilentlyContinue
      $current = if ($null -ne $props.ProxyServer) { [string]$props.ProxyServer } else { '' }
      $ours = $current -match '127\\.0\\.0\\.1:(${httpPort}|${socksPort})\\b'
      if ($current -eq '' -or $ours) {
        Set-ItemProperty -Path $reg -Name ProxyEnable -Value 0
        if ($ours) {
          Remove-ItemProperty -Path $reg -Name ProxyServer -ErrorAction SilentlyContinue
        }
        Write-Host "Proxy disabled"
      } else {
        Write-Host "Left foreign proxy configuration untouched: $current"
      }
      Disable-LocalhostWinHttpProxyFallback
      ${WININET_REFRESH_SNIPPET}
    `);
  }

  async restoreState(snapshot: WindowsProxySnapshot): Promise<void> {
    const encoded = Buffer.from(JSON.stringify(snapshot), 'utf8').toString(
      'base64',
    );
    await this.runPowerShellCommand(`
      ${WINHTTP_LOCALHOST_RESET_SNIPPET}
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
      ${WININET_REFRESH_SNIPPET}
      Disable-LocalhostWinHttpProxyFallback
    `);
  }

  private async runPowerShellScript(script: string): Promise<void> {
    const output = await this.runPowerShellCommand(script);
    const trimmed = output.trim();
    if (trimmed) {
      logger.info('SystemProxyService', 'Proxy script output', {
        output: trimmed.slice(0, 500),
      });
    }
  }

  /**
   * `-EncodedCommand` keeps the script out of the filesystem and out of the
   * command line, so neither a planted file nor argument parsing can alter it.
   */
  private runPowerShellCommand(script: string): Promise<string> {
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    return runCommand(
      powerShellPath(),
      [
        '-NoLogo',
        '-NonInteractive',
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-EncodedCommand',
        encoded,
      ],
      SCRIPT_TIMEOUT_MS,
    );
  }
}

function assertPort(port: number): void {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid proxy port: ${port}`);
  }
}
