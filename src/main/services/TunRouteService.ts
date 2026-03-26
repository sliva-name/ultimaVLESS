import { spawn } from 'child_process';
import { promisify } from 'util';
import dns from 'dns';
import { VlessConfig } from '../../shared/types';
import { logger } from './LoggerService';
import { configService } from './ConfigService';

const dnsLookup = promisify(dns.lookup);
const TUN_INTERFACE_NAME = 'ultima0';
const TUN_ADDRESS = '172.19.0.1';
const TUN_PREFIX = 30;
const TUN_NEXTHOP = '172.19.0.2';
const TUN_ROUTE_METRIC = 1;
const TUN_WAIT_TIMEOUT = 20000;
const TUN_WAIT_INTERVAL = 300;
const POWERSHELL_TIMEOUT = 30000;
const DNS_TIMEOUT = 8000;
const ENABLE_TIMEOUT = 60000;

interface DefaultRouteInfo {
  gateway: string;
  interfaceIndex: number;
  interfaceName: string;
}

interface RunPowerShellOptions {
  allowNonZeroExit?: boolean;
}

export class TunRouteService {
  private addedRoutes: { destination: string; mask: string; interfaceIndex?: number }[] = [];

  public async enable(config: VlessConfig): Promise<void> {
    if (process.platform !== 'win32') {
      logger.info('TunRouteService', 'Not Windows, skipping TUN routing');
      return;
    }

    const startedAt = Date.now();
    const deadline = startedAt + ENABLE_TIMEOUT;
    try {
      const [defaultRoute, proxyIps, tunInterfaceIndex] = await Promise.all([
        this.getDefaultRoute(),
        this.resolveProxyAddresses(config.address),
        this.waitForTunInterface(),
      ]);
      this.ensureWithinDeadline(deadline, 'initial discovery');
      logger.info('TunRouteService', 'Discovery completed', {
        hasDefaultRoute: !!defaultRoute,
        proxyIpCount: proxyIps.length,
        tunInterfaceIndex,
      });

      if (!defaultRoute) {
        throw new Error('Could not get default route. Check network connection.');
      }
      if (proxyIps.length === 0) {
        throw new Error(`Could not resolve proxy server address: ${config.address}`);
      }

      await this.ensureTunAddress();
      this.ensureWithinDeadline(deadline, 'set TUN interface address');

      for (const proxyIp of proxyIps) {
        this.ensureWithinDeadline(deadline, `add host route for ${proxyIp}`);
        await this.addRoute(proxyIp, '255.255.255.255', defaultRoute.gateway, 1, defaultRoute.interfaceIndex);
      }
      this.ensureWithinDeadline(deadline, 'add default route via TUN');
      await this.addDefaultRouteViaTun(tunInterfaceIndex);

      logger.info('TunRouteService', 'TUN routing enabled', {
        proxyIps,
        defaultGateway: defaultRoute.gateway,
        setupDurationMs: Date.now() - startedAt,
      });
    } catch (error) {
      await this.disable();
      throw error;
    }
  }

  public async disable(): Promise<void> {
    if (process.platform !== 'win32') return;

    for (const route of [...this.addedRoutes].reverse()) {
      try {
        await this.deleteRoute(route);
      } catch (error) {
        logger.warn('TunRouteService', 'Failed to remove route', {
          destination: route.destination,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    this.addedRoutes = [];
    try {
      await this.cleanupStaleTunRoutes();
    } catch (error) {
      logger.warn('TunRouteService', 'Stale route cleanup failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    logger.info('TunRouteService', 'TUN routing disabled');
  }

  private async getDefaultRoute(): Promise<DefaultRouteInfo | null> {
    const script = `
      $route = Get-NetRoute -DestinationPrefix "0.0.0.0/0" -ErrorAction SilentlyContinue |
        Where-Object { $_.NextHop -ne "0.0.0.0" } |
        ForEach-Object {
          $if = Get-NetAdapter -InterfaceIndex $_.InterfaceIndex -ErrorAction SilentlyContinue
          if ($if -and $if.Name -ne "${TUN_INTERFACE_NAME}" -and $if.Status -eq "Up") {
            $ipif = Get-NetIPInterface -InterfaceIndex $_.InterfaceIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue
            [PSCustomObject]@{
              InterfaceIndex = $_.InterfaceIndex
              NextHop = $_.NextHop
              InterfaceName = $if.Name
              EffectiveMetric = ($_.RouteMetric + ($ipif.InterfaceMetric))
            }
          }
        } |
        Sort-Object EffectiveMetric |
        Select-Object -First 1
      if ($route) {
        $ifIndex = $route.InterfaceIndex
        $gw = $route.NextHop
        $ifName = $route.InterfaceName
        Write-Output "$ifIndex|$gw|$ifName"
      }
    `;
    const out = await this.runPowerShell(script, { allowNonZeroExit: true });
    const match = out.trim().match(/^(\d+)\|([^\s|]+)\|(.+)$/);
    if (!match) return null;
    return {
      interfaceIndex: parseInt(match[1], 10),
      gateway: match[2].trim(),
      interfaceName: match[3].trim(),
    };
  }

  private async waitForTunInterface(): Promise<number> {
    const script = `
      $deadline = (Get-Date).AddMilliseconds(${TUN_WAIT_TIMEOUT})
      while ((Get-Date) -lt $deadline) {
        $adapter = Get-NetAdapter -Name "${TUN_INTERFACE_NAME}" -ErrorAction SilentlyContinue
        if (-not $adapter) {
          $adapter = Get-NetAdapter -ErrorAction SilentlyContinue |
            Where-Object {
              $_.Status -eq "Up" -and (
                $_.Name -like "${TUN_INTERFACE_NAME}*" -or
                $_.InterfaceDescription -like "*Wintun*"
              )
            } |
            Sort-Object ifIndex |
            Select-Object -First 1
        }
        if ($adapter) {
          Write-Output $adapter.ifIndex
          exit 0
        }
        Start-Sleep -Milliseconds ${TUN_WAIT_INTERVAL}
      }
      Write-Output "NOT_FOUND"
      exit 1
    `;
    const out = await this.runPowerShell(script).catch((error) => {
      const details = error instanceof Error ? error.message : String(error);
      throw new Error(
        `TUN interface did not appear within ${TUN_WAIT_TIMEOUT / 1000}s. ` +
        `Make sure app runs as Administrator and Xray has TUN support. Details: ${details}`
      );
    });
    const idx = parseInt(out.trim(), 10);
    if (Number.isNaN(idx)) {
      throw new Error(
        `TUN interface did not appear within ${TUN_WAIT_TIMEOUT / 1000}s. ` +
        `Make sure app runs as Administrator and Xray has TUN support.`
      );
    }
    logger.info('TunRouteService', 'TUN interface found', { index: idx });
    return idx;
  }

  private async getTunInterfaceIndex(): Promise<number | null> {
    const script = `
      $adapter = Get-NetAdapter -Name "${TUN_INTERFACE_NAME}" -ErrorAction SilentlyContinue
      if ($adapter) { Write-Output $adapter.ifIndex }
    `;
    const out = await this.runPowerShell(script, { allowNonZeroExit: true });
    const n = parseInt(out.trim(), 10);
    return Number.isNaN(n) ? null : n;
  }

  private async ensureTunAddress(): Promise<void> {
    const script = `
      $addr = Get-NetIPAddress -InterfaceAlias "${TUN_INTERFACE_NAME}" -AddressFamily IPv4 -ErrorAction SilentlyContinue
      if (-not $addr) {
        New-NetIPAddress -InterfaceAlias "${TUN_INTERFACE_NAME}" -IPAddress ${TUN_ADDRESS} -PrefixLength ${TUN_PREFIX} -ErrorAction Stop
      }
    `;
    try {
      await this.runPowerShell(script);
    } catch (e) {
      logger.warn('TunRouteService', 'Could not set TUN address (Xray may have set it)', {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  private async resolveProxyAddresses(address: string): Promise<string[]> {
    if (this.isIp(address)) return [address];
    try {
      const result = await Promise.race<dns.LookupAddress[] | dns.LookupAddress>([
        dnsLookup(address, { family: 4, all: true }),
        this.sleep(DNS_TIMEOUT).then(() => Promise.reject(new Error('DNS lookup timeout'))),
      ]);
      const addresses = Array.isArray(result)
        ? result.map((r) => r.address)
        : [result.address];
      return [...new Set(addresses)];
    } catch {
      return [];
    }
  }

  private isIp(str: string): boolean {
    return /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(str);
  }

  private async addRoute(
    destination: string,
    mask: string,
    gateway: string,
    metric: number,
    interfaceIndex?: number
  ): Promise<void> {
    const prefixLen = this.maskToPrefix(mask);
    const destPrefix = `${destination}/${prefixLen}`;
    const ifPart = interfaceIndex != null ? ` -InterfaceIndex ${interfaceIndex}` : '';
    const script = `
      $existing = Get-NetRoute -DestinationPrefix "${destPrefix}"${ifPart} -ErrorAction SilentlyContinue | Select-Object -First 1
      if (-not $existing) {
        New-NetRoute -DestinationPrefix "${destPrefix}" -NextHop "${gateway}"${ifPart} -RouteMetric ${metric} -ErrorAction Stop
      }
    `;
    await this.runPowerShell(script);
    this.addedRoutes.push({ destination, mask, interfaceIndex });
  }

  private maskToPrefix(mask: string): number {
    const parts = mask.split('.').map(Number);
    let n = 0;
    for (const p of parts) n = (n << 8) | p;
    let bits = 0;
    while (n) {
      bits += n & 1;
      n >>>= 1;
    }
    return bits;
  }

  private async addDefaultRouteViaTun(tunIdx: number): Promise<void> {
    const script = `
      $existing = Get-NetRoute -DestinationPrefix "0.0.0.0/0" -InterfaceIndex ${tunIdx} -ErrorAction SilentlyContinue
      if (-not $existing) {
        New-NetRoute -DestinationPrefix "0.0.0.0/0" -NextHop "${TUN_NEXTHOP}" -InterfaceIndex ${tunIdx} -RouteMetric ${TUN_ROUTE_METRIC} -ErrorAction Stop
      }
    `;
    await this.runPowerShell(script);
    this.addedRoutes.push({ destination: '0.0.0.0', mask: '0.0.0.0', interfaceIndex: tunIdx });
  }

  private async deleteRoute(route: { destination: string; mask: string; interfaceIndex?: number }): Promise<void> {
    const prefix = route.destination === '0.0.0.0' ? '0.0.0.0/0' : `${route.destination}/32`;
    const ifPart = route.interfaceIndex != null
      ? ` -InterfaceIndex ${route.interfaceIndex}`
      : '';
    const script = `
      Remove-NetRoute -DestinationPrefix "${prefix}"${ifPart} -ErrorAction SilentlyContinue
    `;
    await this.runPowerShell(script, { allowNonZeroExit: true });
  }

  private async cleanupStaleTunRoutes(): Promise<void> {
    const knownServerIps = this.getKnownServerIps();
    const tunIndex = await this.getTunInterfaceIndex();
    if (tunIndex != null) {
      await this.deleteRouteByPrefixAndMetric('0.0.0.0/0', TUN_ROUTE_METRIC, tunIndex).catch((error) => {
        logger.warn('TunRouteService', 'Failed to cleanup stale TUN default route', {
          interfaceIndex: tunIndex,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }

    for (const ip of knownServerIps) {
      await this.deleteRouteByPrefixAndMetric(`${ip}/32`, 1).catch((error) => {
        logger.warn('TunRouteService', 'Failed to cleanup stale host route', {
          destination: `${ip}/32`,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }

    logger.info('TunRouteService', 'Stale route cleanup finished', {
      removedHostRouteCandidates: knownServerIps.length,
      checkedTunDefaultRoute: tunIndex != null,
    });
  }

  private getKnownServerIps(): string[] {
    const servers = configService.getServers();
    const ips = servers
      .map((server) => server.address)
      .filter((address) => this.isIp(address));
    return [...new Set(ips)];
  }

  private async deleteRouteByPrefixAndMetric(
    destinationPrefix: string,
    metric: number,
    interfaceIndex?: number
  ): Promise<void> {
    const ifPart = interfaceIndex != null ? ` -InterfaceIndex ${interfaceIndex}` : '';
    const script = `
      Get-NetRoute -DestinationPrefix "${destinationPrefix}"${ifPart} -ErrorAction SilentlyContinue |
        Where-Object { $_.RouteMetric -eq ${metric} } |
        Remove-NetRoute -Confirm:$false -ErrorAction SilentlyContinue
    `;
    await this.runPowerShell(script, { allowNonZeroExit: true });
  }

  private runPowerShell(script: string, options: RunPowerShellOptions = {}): Promise<string> {
    return new Promise((resolve, reject) => {
      const normalizedScript = `$ProgressPreference = 'SilentlyContinue'\n${script}`;
      const encodedScript = Buffer.from(normalizedScript, 'utf16le').toString('base64');
      const ps = spawn(
        'powershell.exe',
        [
          '-NoLogo',
          '-NonInteractive',
          '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-EncodedCommand',
          encodedScript,
        ],
        { windowsHide: true }
      );

      const timeout = setTimeout(() => {
        ps.kill('SIGTERM');
        reject(new Error(`PowerShell command timed out after ${POWERSHELL_TIMEOUT / 1000}s`));
      }, POWERSHELL_TIMEOUT);

      let stdout = '';
      let stderr = '';

      ps.stdout?.on('data', (chunk) => {
        stdout += chunk.toString();
      });

      ps.stderr?.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      ps.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      ps.on('close', (code) => {
        clearTimeout(timeout);
        if (code === 0) {
          resolve(stdout);
          return;
        }
        if (options.allowNonZeroExit && stderr.trim().length === 0) {
          resolve(stdout);
          return;
        }
        const combined = `${stderr}\n${stdout}`.trim();
        const cleaned = this.cleanPowerShellError(combined);
        const fallbackMessage = `PowerShell exited with code ${code} (no stdout/stderr).`;
        const message = cleaned || fallbackMessage;
        logger.warn('TunRouteService', 'PowerShell command failed', {
          code,
          message,
          stdoutBytes: Buffer.byteLength(stdout, 'utf8'),
          stderrBytes: Buffer.byteLength(stderr, 'utf8'),
          scriptPreview: this.scriptPreview(script),
        });
        reject(new Error(message));
      });
    });
  }

  private cleanPowerShellError(message: string): string {
    const noClixmlPrefix = message.replace(/#<\s*CLIXML/g, '').trim();
    return noClixmlPrefix
      .replace(/<Objs[\s\S]*<\/Objs>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private scriptPreview(script: string): string {
    return script
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 180);
  }

  private ensureWithinDeadline(deadline: number, stage: string): void {
    if (Date.now() <= deadline) {
      return;
    }
    throw new Error(
      `TUN setup timed out after ${ENABLE_TIMEOUT / 1000}s while running: ${stage}. ` +
      'Xray may not support TUN on this system.'
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const tunRouteService = new TunRouteService();
