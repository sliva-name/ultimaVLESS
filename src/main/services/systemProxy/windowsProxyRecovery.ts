import fs from 'fs';
import path from 'path';
import { logger } from '@/main/services/LoggerService';
import { runCommand } from './runCommand';

export const WINDOWS_PROXY_RECOVERY_TASK_NAME = 'UltimaVLESS_ProxyRecovery';
const LEGACY_SCHEDULED_TASK_NAME = 'UltimaVLESS System Proxy Recovery';
export const RUN_KEY_VALUE_NAME = 'UltimaVLESSProxyRecovery';
const RUN_KEY_PATH = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';

const TASK_TIMEOUT_MS = 15000;
const RECOVERY_SCRIPT_FILE = 'recover_system_proxy.ps1';
/** Legacy .cmd launcher — replaced by the windowless .vbs launcher; removed on upgrade. */
const LEGACY_RECOVERY_CMD_FILE = 'recover_proxy.cmd';
const RECOVERY_VBS_FILE = 'recover_proxy.vbs';
const RECOVERY_TARGET_FILE = 'recovery-target.txt';

const RECOVERY_SCRIPT = String.raw`param()
$ErrorActionPreference = 'Stop'

function Write-RecoveryLog([string]$Message) {
  $logDir = Join-Path ([Environment]::GetFolderPath('CommonApplicationData')) 'UltimaVLESS'
  if (-not (Test-Path -LiteralPath $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
  $logPath = Join-Path $logDir 'recovery.log'
  Add-Content -LiteralPath $logPath -Value "$(Get-Date -Format o) $Message" -Encoding UTF8
}

function Refresh-InternetSettings {
  $codes = @"
using System;
using System.Runtime.InteropServices;
public class InternetSettings {
    [DllImport("wininet.dll")]
    public static extern bool InternetSetOption(IntPtr hInternet, int dwOption, IntPtr lpBuffer, int dwBufferLength);
    public const int INTERNET_OPTION_SETTINGS_CHANGED = 39;
    public const int INTERNET_OPTION_REFRESH = 37;
}
"@
  Add-Type -TypeDefinition $codes -ErrorAction SilentlyContinue
  [InternetSettings]::InternetSetOption([IntPtr]::Zero, [InternetSettings]::INTERNET_OPTION_SETTINGS_CHANGED, [IntPtr]::Zero, 0) | Out-Null
  [InternetSettings]::InternetSetOption([IntPtr]::Zero, [InternetSettings]::INTERNET_OPTION_REFRESH, [IntPtr]::Zero, 0) | Out-Null
}

function Disable-LocalhostWinHttpProxyFallback {
  try {
    $output = (& netsh winhttp dump 2>&1 | Out-String)
    if ($LASTEXITCODE -ne 0) {
      Write-RecoveryLog "WinHTTP proxy inspection skipped: $output"
      return $false
    }
    $proxyServer = $null
    if ($output -match 'proxy-server="([^"]*)"') {
      $proxyServer = $Matches[1]
    }
    if ($proxyServer -match '(?i)(127\.0\.0\.1|localhost|\[::1\])') {
      & netsh winhttp reset proxy | Out-Null
      if ($LASTEXITCODE -eq 0) {
        Write-RecoveryLog 'Reset orphaned localhost WinHTTP proxy'
        return $true
      }
      Write-RecoveryLog "WinHTTP proxy reset skipped: exit code $LASTEXITCODE"
    }
  } catch {
    Write-RecoveryLog "WinHTTP proxy cleanup skipped: $_"
  }
  return $false
}

function Disable-LocalhostProxyFallback {
  $reg = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings'
  $props = Get-ItemProperty -Path $reg
  $enabled = [int]($props.ProxyEnable | Select-Object -First 1)
  $server = [string]($props.ProxyServer | Select-Object -First 1)
  $changed = $false
  if ($enabled -eq 1 -and $server -match '(?i)(127\.0\.0\.1|localhost|\[::1\])') {
    Set-ItemProperty -Path $reg -Name ProxyEnable -Value 0
    Refresh-InternetSettings
    Write-RecoveryLog 'Disabled orphaned localhost proxy (fallback)'
    $changed = $true
  }
  if (Disable-LocalhostWinHttpProxyFallback) { $changed = $true }
  return $changed
}

$programDataDir = Join-Path ([Environment]::GetFolderPath('CommonApplicationData')) 'UltimaVLESS'
$targetFile = Join-Path $programDataDir 'recovery-target.txt'
if (-not (Test-Path -LiteralPath $targetFile)) {
  Disable-LocalhostProxyFallback | Out-Null
  exit 0
}

$snapshotPath = (Get-Content -LiteralPath $targetFile -Raw -Encoding UTF8).Trim()
if ([string]::IsNullOrWhiteSpace($snapshotPath)) {
  Remove-Item -LiteralPath $targetFile -Force -ErrorAction SilentlyContinue
  Disable-LocalhostProxyFallback | Out-Null
  exit 0
}

if (-not (Test-Path -LiteralPath $snapshotPath)) {
  Write-RecoveryLog "Snapshot missing at $snapshotPath"
  Remove-Item -LiteralPath $targetFile -Force -ErrorAction SilentlyContinue
  if (Disable-LocalhostProxyFallback) { exit 0 }
  exit 0
}

$reg = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings'
try {
  $json = Get-Content -LiteralPath $snapshotPath -Raw -Encoding UTF8
  $state = $json | ConvertFrom-Json
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
  Remove-Item -LiteralPath $snapshotPath -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $targetFile -Force -ErrorAction SilentlyContinue
  Refresh-InternetSettings
  Disable-LocalhostWinHttpProxyFallback | Out-Null
  Write-RecoveryLog "Restored proxy snapshot from $snapshotPath"
  exit 0
} catch {
  Write-RecoveryLog "Recovery failed: $_"
  Set-ItemProperty -Path $reg -Name ProxyEnable -Value 0
  Remove-Item -LiteralPath $targetFile -Force -ErrorAction SilentlyContinue
  Refresh-InternetSettings
  Disable-LocalhostWinHttpProxyFallback | Out-Null
  exit 1
}
`;

export function getProgramDataRecoveryDir(): string {
  const base = process.env.ProgramData || 'C:\\ProgramData';
  return path.join(base, 'UltimaVLESS');
}

function ensureRecoveryDir(): string {
  const dir = getProgramDataRecoveryDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function writeRecoveryTarget(snapshotPath: string): void {
  const dir = ensureRecoveryDir();
  fs.writeFileSync(path.join(dir, RECOVERY_TARGET_FILE), snapshotPath, 'utf8');
}

export function clearRecoveryTarget(): void {
  try {
    fs.unlinkSync(path.join(getProgramDataRecoveryDir(), RECOVERY_TARGET_FILE));
  } catch {
    // ignore missing file
  }
}

export function getRecoveryVbsPath(): string {
  return path.join(getProgramDataRecoveryDir(), RECOVERY_VBS_FILE);
}

export function getRecoveryScriptPath(): string {
  return path.join(getProgramDataRecoveryDir(), RECOVERY_SCRIPT_FILE);
}

/**
 * Builds the launch command used by both the Run key and the logon scheduled
 * task. `wscript.exe` is a GUI-subsystem host, so it shows no console window at
 * all — this is what avoids the brief console flash on logon that a `.cmd`
 * launcher produced (a `.cmd` always spawns a visible conhost window before the
 * hidden PowerShell child even starts).
 */
function buildLogonLaunchCommand(vbsPath: string): string {
  return `wscript.exe //B //Nologo "${vbsPath}"`;
}

function removeLegacyCmdLauncher(dir: string): void {
  try {
    fs.unlinkSync(path.join(dir, LEGACY_RECOVERY_CMD_FILE));
  } catch {
    // ignore: file may not exist on fresh installs
  }
}

/**
 * Builds the windowless .vbs launcher source. VBScript string literals escape
 * an embedded double quote by doubling it (`""`), so the quoted PowerShell
 * script path stays a single argument inside the `sh.Run` string literal.
 * Exported for unit tests that verify the generated VBScript is syntactically
 * valid.
 */
export function buildRecoveryVbsContent(scriptPath: string): string {
  const psCommand =
    `powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden ` +
    `-File ""${scriptPath}""`;
  return [
    'Set sh = CreateObject("WScript.Shell")',
    `sh.Run "${psCommand}", 0, False`,
    '',
  ].join('\r\n');
}

export function writeRecoveryLauncherFiles(): string {
  const dir = ensureRecoveryDir();
  const scriptPath = path.join(dir, RECOVERY_SCRIPT_FILE);
  const vbsPath = path.join(dir, RECOVERY_VBS_FILE);
  fs.writeFileSync(scriptPath, RECOVERY_SCRIPT, 'utf8');
  fs.writeFileSync(vbsPath, buildRecoveryVbsContent(scriptPath), 'utf8');
  removeLegacyCmdLauncher(dir);
  return vbsPath;
}

async function installRegistryRunKey(vbsPath: string): Promise<void> {
  const value = buildLogonLaunchCommand(vbsPath);
  await runCommand(
    'reg',
    [
      'add',
      RUN_KEY_PATH,
      '/v',
      RUN_KEY_VALUE_NAME,
      '/t',
      'REG_SZ',
      '/d',
      value,
      '/f',
    ],
    TASK_TIMEOUT_MS,
  );
  logger.info('SystemProxyService', 'Installed proxy recovery Run key', {
    valueName: RUN_KEY_VALUE_NAME,
    value,
  });
}

async function uninstallRegistryRunKey(): Promise<void> {
  try {
    await runCommand(
      'reg',
      ['delete', RUN_KEY_PATH, '/v', RUN_KEY_VALUE_NAME, '/f'],
      TASK_TIMEOUT_MS,
    );
    logger.info('SystemProxyService', 'Removed proxy recovery Run key', {
      valueName: RUN_KEY_VALUE_NAME,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes('ERROR: The system was unable to find') ||
      message.includes('не удается найти')
    ) {
      return;
    }
    throw error;
  }
}

async function removeLegacyScheduledTask(): Promise<void> {
  try {
    await runCommand(
      'schtasks',
      ['/Delete', '/TN', LEGACY_SCHEDULED_TASK_NAME, '/F'],
      TASK_TIMEOUT_MS,
    );
  } catch {
    // ignore missing legacy task
  }
}

async function installLogonScheduledTask(vbsPath: string): Promise<void> {
  await removeLegacyScheduledTask();
  const launchCommand = buildLogonLaunchCommand(vbsPath);
  await runCommand(
    'schtasks',
    [
      '/Create',
      '/TN',
      WINDOWS_PROXY_RECOVERY_TASK_NAME,
      '/SC',
      'ONLOGON',
      '/TR',
      launchCommand,
      '/RL',
      'LIMITED',
      '/F',
    ],
    TASK_TIMEOUT_MS,
  );
  logger.info('SystemProxyService', 'Installed logon recovery scheduled task', {
    taskName: WINDOWS_PROXY_RECOVERY_TASK_NAME,
    launchCommand,
  });
}

async function uninstallLogonScheduledTask(): Promise<void> {
  try {
    await runCommand(
      'schtasks',
      ['/Delete', '/TN', WINDOWS_PROXY_RECOVERY_TASK_NAME, '/F'],
      TASK_TIMEOUT_MS,
    );
    logger.info('SystemProxyService', 'Removed logon recovery scheduled task', {
      taskName: WINDOWS_PROXY_RECOVERY_TASK_NAME,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes('cannot find') ||
      message.includes('не удается найти') ||
      message.includes('0x8004130F')
    ) {
      return;
    }
    throw error;
  }
}

/** Registers logon recovery (Run key + scheduled task) using ASCII-only launcher paths. */
export async function installLogonRecovery(
  snapshotPath: string,
): Promise<void> {
  writeRecoveryTarget(snapshotPath);
  const vbsPath = writeRecoveryLauncherFiles();
  await installRegistryRunKey(vbsPath);
  try {
    await installLogonScheduledTask(vbsPath);
  } catch (error) {
    logger.warn(
      'SystemProxyService',
      'Scheduled task install failed; Run key recovery remains active',
      {
        error: error instanceof Error ? error.message : String(error),
      },
    );
  }
}

export async function uninstallLogonRecovery(): Promise<void> {
  clearRecoveryTarget();
  await Promise.all([uninstallRegistryRunKey(), uninstallLogonScheduledTask()]);
}

// Backwards-compatible aliases used by SystemProxyService
export const installLogonRecoveryTask = installLogonRecovery;
export const uninstallLogonRecoveryTask = uninstallLogonRecovery;
