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
const DEFAULT_ROUTE_WAIT_TIMEOUT = 12000;
const DEFAULT_ROUTE_WAIT_INTERVAL = 500;
const DEFAULT_ROUTE_STABLE_HITS = 2;
const DEFAULT_ROUTE_ADD_RETRIES = 3;
const DEFAULT_ROUTE_ADD_RETRY_DELAY_MS = 400;
const UNIX_COMMAND_TIMEOUT = 10000;

interface DefaultRouteInfo {
  gateway: string;
  interfaceIndex: number;
  interfaceName: string;
  localAddress: string | null;
}

export interface TunRoutingPlan {
  defaultRoute: DefaultRouteInfo;
  proxyIps: string[];
}

interface RunPowerShellOptions {
  allowNonZeroExit?: boolean;
}

export class TunRouteService {
  private addedRoutes: { destination: string; mask: string; interfaceIndex?: number }[] = [];

  public isSupported(): boolean {
    return process.platform === 'win32' || process.platform === 'linux' || process.platform === 'darwin';
  }

  public getUnsupportedReason(): string | null {
    if (this.isSupported()) {
      return null;
    }
    return 'TUN mode is not supported on this operating system.';
  }

  public async prepareRoutingPlan(config: VlessConfig): Promise<TunRoutingPlan> {
    const unsupportedReason = this.getUnsupportedReason();
    if (unsupportedReason) {
      throw new Error(unsupportedReason);
    }
    if (process.platform !== 'win32') {
      return this.prepareUnixRoutingPlan(config);
    }
    const [defaultRoute, proxyIps] = await Promise.all([
      this.waitForDefaultRoute(),
      this.resolveProxyAddresses(config.address),
    ]);

    if (!defaultRoute) {
      throw new Error('Could not get default route. Check network connection.');
    }
    if (proxyIps.length === 0) {
      throw new Error(`Could not resolve proxy server address: ${config.address}`);
    }

    return { defaultRoute, proxyIps };
  }

  public async enable(config: VlessConfig, plan?: TunRoutingPlan): Promise<void> {
    if (process.platform !== 'win32') {
      const routingPlan = plan ?? (await this.prepareRoutingPlan(config));
      logger.info('TunRouteService', 'Using Xray auto-route for TUN mode on Unix platform', {
        platform: process.platform,
        proxyIpCount: routingPlan.proxyIps.length,
        defaultInterface: routingPlan.defaultRoute.interfaceName,
      });
      return;
    }

    const startedAt = Date.now();
    const deadline = startedAt + ENABLE_TIMEOUT;
    try {
      const [routingPlan, tunInterfaceIndex] = await Promise.all([
        plan ? Promise.resolve(plan) : this.prepareRoutingPlan(config),
        this.waitForTunInterface(),
      ]);
      const { defaultRoute, proxyIps } = routingPlan;
      this.ensureWithinDeadline(deadline, 'initial discovery');
      logger.info('TunRouteService', 'Discovery completed', {
        hasDefaultRoute: true,
        proxyIpCount: proxyIps.length,
        tunInterfaceIndex,
      });
      logger.info('TunRouteService', 'Using default route candidate', {
        interfaceIndex: defaultRoute.interfaceIndex,
        interfaceName: defaultRoute.interfaceName,
        gateway: defaultRoute.gateway,
        localAddress: defaultRoute.localAddress,
      });

      await this.ensureTunAddress(tunInterfaceIndex);
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

  private async prepareUnixRoutingPlan(config: VlessConfig): Promise<TunRoutingPlan> {
    const [defaultRoute, proxyIps] = await Promise.all([
      this.getUnixDefaultRouteInfo(),
      this.resolveProxyAddresses(config.address),
    ]);
    if (!defaultRoute) {
      throw new Error('Could not get default route. Check network connection.');
    }
    if (proxyIps.length === 0) {
      throw new Error(`Could not resolve proxy server address: ${config.address}`);
    }
    return { defaultRoute, proxyIps };
  }

  private async getUnixDefaultRouteInfo(): Promise<DefaultRouteInfo | null> {
    if (process.platform === 'linux') {
      return this.getLinuxDefaultRouteInfo();
    }
    if (process.platform === 'darwin') {
      return this.getMacosDefaultRouteInfo();
    }
    return null;
  }

  private async getLinuxDefaultRouteInfo(): Promise<DefaultRouteInfo | null> {
    const routeOut = await this.runUnixCommand('ip', ['-4', 'route', 'show', 'default'], { allowNonZeroExit: true });
    const line = routeOut
      .split(/\r?\n/)
      .map((value) => value.trim())
      .find((value) => value.length > 0);
    if (!line) {
      return null;
    }
    const gatewayMatch = /\bvia\s+([0-9.]+)/.exec(line);
    const devMatch = /\bdev\s+([^\s]+)/.exec(line);
    if (!gatewayMatch || !devMatch) {
      return null;
    }
    const interfaceName = devMatch[1];
    const localAddress = await this.getLinuxInterfaceAddress(interfaceName);
    return {
      gateway: gatewayMatch[1],
      interfaceIndex: 0,
      interfaceName,
      localAddress,
    };
  }

  private async getLinuxInterfaceAddress(interfaceName: string): Promise<string | null> {
    const addrOut = await this.runUnixCommand('ip', ['-4', '-o', 'addr', 'show', 'dev', interfaceName], { allowNonZeroExit: true });
    const match = /\binet\s+([0-9.]+)\//.exec(addrOut);
    return match ? match[1] : null;
  }

  private async getMacosDefaultRouteInfo(): Promise<DefaultRouteInfo | null> {
    const routeOut = await this.runUnixCommand('route', ['-n', 'get', 'default'], { allowNonZeroExit: true });
    const gatewayMatch = /^\s*gateway:\s+([0-9.]+)\s*$/m.exec(routeOut);
    const interfaceMatch = /^\s*interface:\s+([^\s]+)\s*$/m.exec(routeOut);
    if (!gatewayMatch || !interfaceMatch) {
      return null;
    }
    const interfaceName = interfaceMatch[1];
    const localAddress = await this.getMacosInterfaceAddress(interfaceName);
    return {
      gateway: gatewayMatch[1],
      interfaceIndex: 0,
      interfaceName,
      localAddress,
    };
  }

  private async getMacosInterfaceAddress(interfaceName: string): Promise<string | null> {
    const output = await this.runUnixCommand('ipconfig', ['getifaddr', interfaceName], { allowNonZeroExit: true });
    const value = output.trim();
    return value.length > 0 ? value : null;
  }

  private runUnixCommand(
    command: string,
    args: string[],
    options: { allowNonZeroExit?: boolean } = {}
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args);
      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`Command timed out after ${UNIX_COMMAND_TIMEOUT / 1000}s: ${command} ${args.join(' ')}`));
      }, UNIX_COMMAND_TIMEOUT);

      let stdout = '';
      let stderr = '';
      child.stdout?.on('data', (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr?.on('data', (chunk) => {
        stderr += chunk.toString();
      });
      child.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.on('close', (code) => {
        clearTimeout(timeout);
        if (code === 0 || options.allowNonZeroExit) {
          resolve(stdout);
          return;
        }
        const details = `${stderr}\n${stdout}`.trim();
        reject(new Error(details || `Command failed with code ${code}: ${command} ${args.join(' ')}`));
      });
    });
  }

  private async getDefaultRoute(): Promise<DefaultRouteInfo | null> {
    const script = `
      $virtualPatterns = @(
        'vEthernet*',
        'Default Switch*',
        '*Hyper-V*',
        '*VirtualBox*',
        '*VMware*',
        '*Loopback*',
        '*Teredo*',
        '*isatap*'
      )
      function IsVirtualLike($name, $description) {
        foreach ($pattern in $virtualPatterns) {
          if ($name -like $pattern -or $description -like $pattern) {
            return $true
          }
        }
        return $false
      }
      function IsValidIPv4($value) {
        $ip = [System.Net.IPAddress]::None
        return [System.Net.IPAddress]::TryParse($value, [ref]$ip) -and $ip.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork
      }
      function NewCandidate($routeObj) {
        $if = Get-NetAdapter -InterfaceIndex $routeObj.InterfaceIndex -ErrorAction SilentlyContinue
        if (-not $if -or $if.Name -eq "${TUN_INTERFACE_NAME}" -or $if.Status -ne "Up") {
          return $null
        }
        if (-not (IsValidIPv4 $routeObj.NextHop) -or $routeObj.NextHop -eq "0.0.0.0") {
          return $null
        }
        $ipif = Get-NetIPInterface -InterfaceIndex $routeObj.InterfaceIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue
        $profile = Get-NetConnectionProfile -InterfaceIndex $routeObj.InterfaceIndex -ErrorAction SilentlyContinue
        $ifMetric = if ($ipif) { [int]$ipif.InterfaceMetric } else { 0 }
        $isVirtual = IsVirtualLike $if.Name $if.InterfaceDescription
        $isConnectedProfile = if ($profile) { $profile.IPv4Connectivity -ne "Disconnected" } else { $true }
        [PSCustomObject]@{
          InterfaceIndex = $routeObj.InterfaceIndex
          NextHop = $routeObj.NextHop
          InterfaceName = $if.Name
          EffectiveMetric = ([int]$routeObj.RouteMetric + $ifMetric)
          IsVirtual = $isVirtual
          IsConnectedProfile = $isConnectedProfile
        }
      }
      $route = Get-NetRoute -DestinationPrefix "0.0.0.0/0" -ErrorAction SilentlyContinue |
        Where-Object { $_.NextHop -ne "0.0.0.0" } |
        ForEach-Object { NewCandidate $_ } |
        Where-Object { $_ -ne $null } |
        Sort-Object @{Expression = "IsVirtual"; Ascending = $true}, @{Expression = "IsConnectedProfile"; Descending = $true}, @{Expression = "EffectiveMetric"; Ascending = $true} |
        Select-Object -First 1
      if (-not $route) {
        $route = Get-CimInstance Win32_IP4RouteTable -ErrorAction SilentlyContinue |
          Where-Object { $_.Destination -eq "0.0.0.0" -and $_.Mask -eq "0.0.0.0" } |
          ForEach-Object {
            [PSCustomObject]@{
              InterfaceIndex = [int]$_.InterfaceIndex
              NextHop = $_.NextHop
              RouteMetric = [int]$_.Metric1
            }
          } |
          ForEach-Object { NewCandidate $_ } |
          Where-Object { $_ -ne $null } |
          Sort-Object @{Expression = "IsVirtual"; Ascending = $true}, @{Expression = "IsConnectedProfile"; Descending = $true}, @{Expression = "EffectiveMetric"; Ascending = $true} |
          Select-Object -First 1
      }
      if ($route) {
        $local = Get-NetIPAddress -InterfaceIndex $route.InterfaceIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue |
          Where-Object { $_.IPAddress -and $_.IPAddress -ne "127.0.0.1" -and $_.IPAddress -notlike "169.254.*" } |
          Sort-Object @{Expression = "SkipAsSource"; Ascending = $true}, @{Expression = "PrefixLength"; Descending = $true} |
          Select-Object -First 1 -ExpandProperty IPAddress
        $ifIndex = $route.InterfaceIndex
        $gw = $route.NextHop
        $ifName = $route.InterfaceName
        Write-Output "$ifIndex|$gw|$ifName|$local"
      }
    `;
    const out = await this.runPowerShell(script, { allowNonZeroExit: true });
    const match = out.trim().match(/^(\d+)\|([^\s|]+)\|([^|]+)(?:\|(.*))?$/);
    if (!match) return null;
    const localAddress = match[4]?.trim() || '';
    return {
      interfaceIndex: parseInt(match[1], 10),
      gateway: match[2].trim(),
      interfaceName: match[3].trim(),
      localAddress: localAddress.length > 0 ? localAddress : null,
    };
  }

  private async waitForDefaultRoute(): Promise<DefaultRouteInfo | null> {
    const startedAt = Date.now();
    let previousRouteKey: string | null = null;
    let stableHits = 0;
    let lastObservedRoute: DefaultRouteInfo | null = null;

    while (Date.now() - startedAt <= DEFAULT_ROUTE_WAIT_TIMEOUT) {
      const route = await this.getDefaultRoute();
      if (route) {
        lastObservedRoute = route;
        const routeKey = `${route.interfaceIndex}|${route.gateway}`;
        if (routeKey === previousRouteKey) {
          stableHits += 1;
        } else {
          previousRouteKey = routeKey;
          stableHits = 1;
        }
        if (stableHits >= DEFAULT_ROUTE_STABLE_HITS) {
          return route;
        }
      } else {
        previousRouteKey = null;
        stableHits = 0;
      }
      await this.sleep(DEFAULT_ROUTE_WAIT_INTERVAL);
    }
    return lastObservedRoute;
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
      if ($adapter) { Write-Output $adapter.ifIndex }
    `;
    const out = await this.runPowerShell(script, { allowNonZeroExit: true });
    const n = parseInt(out.trim(), 10);
    return Number.isNaN(n) ? null : n;
  }

  private async ensureTunAddress(tunInterfaceIndex: number): Promise<void> {
    const script = `
      $existing = Get-NetIPAddress -InterfaceIndex ${tunInterfaceIndex} -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Select-Object -First 1
      if (-not $existing) {
        New-NetIPAddress -InterfaceIndex ${tunInterfaceIndex} -IPAddress ${TUN_ADDRESS} -PrefixLength ${TUN_PREFIX} -ErrorAction Stop
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
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= DEFAULT_ROUTE_ADD_RETRIES; attempt += 1) {
      try {
        const script = `
          $existing = Get-NetRoute -DestinationPrefix "0.0.0.0/0" -InterfaceIndex ${tunIdx} -ErrorAction SilentlyContinue
          if (-not $existing) {
            New-NetRoute -DestinationPrefix "0.0.0.0/0" -NextHop "${TUN_NEXTHOP}" -InterfaceIndex ${tunIdx} -RouteMetric ${TUN_ROUTE_METRIC} -ErrorAction Stop
          }
        `;
        await this.runPowerShell(script);
        this.addedRoutes.push({ destination: '0.0.0.0', mask: '0.0.0.0', interfaceIndex: tunIdx });
        return;
      } catch (error) {
        lastError = error;
        if (attempt < DEFAULT_ROUTE_ADD_RETRIES) {
          logger.warn('TunRouteService', 'Retrying add default route via TUN', {
            interfaceIndex: tunIdx,
            attempt,
            maxAttempts: DEFAULT_ROUTE_ADD_RETRIES,
            error: error instanceof Error ? error.message : String(error),
          });
          await this.sleep(DEFAULT_ROUTE_ADD_RETRY_DELAY_MS);
          continue;
        }
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error('Failed to add default route via TUN');
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
    } else {
      // Fallback: remove stale default route candidates by next hop/metric even if
      // interface alias changed (e.g. "ultima0 #2") and exact index is unknown.
      await this.deleteTunDefaultRoutesByNextHop(TUN_NEXTHOP, TUN_ROUTE_METRIC).catch((error) => {
        logger.warn('TunRouteService', 'Failed to cleanup stale TUN default routes by next hop', {
          nextHop: TUN_NEXTHOP,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }

    let removedHostRoutes = 0;
    try {
      removedHostRoutes = await this.deleteHostRoutesByPrefixesAndMetric(
        knownServerIps.map((ip) => `${ip}/32`),
        1
      );
    } catch (error) {
      logger.warn('TunRouteService', 'Failed to cleanup stale host routes', {
        count: knownServerIps.length,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    logger.info('TunRouteService', 'Stale route cleanup finished', {
      removedHostRouteCandidates: knownServerIps.length,
      removedHostRoutes,
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

  private async deleteTunDefaultRoutesByNextHop(nextHop: string, metric: number): Promise<void> {
    const script = `
      Get-NetRoute -DestinationPrefix "0.0.0.0/0" -ErrorAction SilentlyContinue |
        Where-Object {
          $_.RouteMetric -eq ${metric} -and $_.NextHop -eq "${nextHop}"
        } |
        Remove-NetRoute -Confirm:$false -ErrorAction SilentlyContinue
    `;
    await this.runPowerShell(script, { allowNonZeroExit: true });
  }

  private async deleteHostRoutesByPrefixesAndMetric(
    destinationPrefixes: string[],
    metric: number
  ): Promise<number> {
    if (destinationPrefixes.length === 0) {
      return 0;
    }
    const prefixesLiteral = destinationPrefixes.map((prefix) => `'${prefix}'`).join(', ');
    const script = `
      $targets = @(${prefixesLiteral})
      $targetSet = @{}
      foreach ($target in $targets) {
        $targetSet[$target] = $true
      }
      $removed = 0
      Get-NetRoute -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object {
          $_.RouteMetric -eq ${metric} -and $targetSet.ContainsKey($_.DestinationPrefix)
        } |
        ForEach-Object {
          Remove-NetRoute -DestinationPrefix $_.DestinationPrefix -InterfaceIndex $_.InterfaceIndex -NextHop $_.NextHop -Confirm:$false -ErrorAction SilentlyContinue
          $removed++
        }
      Write-Output $removed
    `;
    const out = await this.runPowerShell(script, { allowNonZeroExit: true });
    const parsed = parseInt(out.trim(), 10);
    return Number.isNaN(parsed) ? 0 : parsed;
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
