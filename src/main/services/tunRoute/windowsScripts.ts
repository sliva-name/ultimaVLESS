import net from 'net';
import {
  TUN_ADDRESS,
  TUN_DNS_SERVERS,
  TUN_IPV6_ADDRESS,
  TUN_IPV6_NEXTHOP,
  TUN_IPV6_PREFIX,
  TUN_INTERFACE_NAME,
  TUN_NEXTHOP,
  TUN_PREFIX,
  TUN_ROUTE_METRIC,
  TUN_WAIT_INTERVAL,
  TUN_WAIT_TIMEOUT,
} from './constants';

/**
 * All values that are interpolated into PowerShell scripts must pass through
 * here. The previous regex (`/^[a-fA-F0-9.:/]+$/`) allowed obviously invalid
 * inputs like "1.1.1.1.1.1" and "::::". `net.isIP` rejects those while still
 * permitting CIDR suffixes (split off and validated separately).
 */
function validateIpOrPrefix(val: string): void {
  if (typeof val !== 'string' || val.length === 0 || val.length > 64) {
    throw new Error(`Invalid IP or prefix format: ${val}`);
  }
  const slashIndex = val.indexOf('/');
  const addressPart = slashIndex === -1 ? val : val.slice(0, slashIndex);
  const prefixPart = slashIndex === -1 ? null : val.slice(slashIndex + 1);

  const family = net.isIP(addressPart);
  if (family === 0) {
    throw new Error(`Invalid IP or prefix format: ${val}`);
  }

  if (prefixPart !== null) {
    if (!/^\d{1,3}$/.test(prefixPart)) {
      throw new Error(`Invalid IP or prefix format: ${val}`);
    }
    const prefix = Number(prefixPart);
    const max = family === 4 ? 32 : 128;
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > max) {
      throw new Error(`Invalid IP or prefix format: ${val}`);
    }
  }
}

function validateInterfaceIndex(value: number | undefined): void {
  if (value === undefined) return;
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
    throw new Error(`Invalid PowerShell interface index: ${value}`);
  }
}

function validateMetric(value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
    throw new Error(`Invalid PowerShell route metric: ${value}`);
  }
}

/**
 * Pure PowerShell script builders for the Windows TUN routing path.
 * Kept side-effect-free so they can be audited/tested independently.
 */

export const getDefaultRouteScript = (): string => `
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

export const waitForTunInterfaceScript = (): string => `
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

export const getTunInterfaceIndexScript = (): string => `
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

export interface EnableTunRoutingParams {
  tunInterfaceIndex: number;
  defaultRouteInterfaceIndex: number;
  gateway: string;
  /** Host prefixes (e.g. `203.0.113.10/32`) for the proxy server IPs. */
  proxyHostPrefixes: string[];
  hostRouteMetric: number;
  defaultRouteRetries: number;
  defaultRouteRetryDelayMs: number;
}

function validateRetryCount(value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > 10) {
    throw new Error(`Invalid default route retry count: ${value}`);
  }
}

function validateRetryDelay(value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > 60000) {
    throw new Error(`Invalid default route retry delay: ${value}`);
  }
}

/**
 * Single-shot script that performs the entire Windows TUN routing setup in one
 * PowerShell process: stale proxy-host-route cleanup, TUN adapter address/DNS,
 * per-proxy host routes via the physical gateway, and the TUN default route
 * (with an in-script retry loop for the transient failures that used to require
 * a fresh process per attempt). Collapsing ~5 spawns into one removes most of
 * the per-process PowerShell startup latency that dominated connect time.
 *
 * The script reports what it created via stdout markers so the caller can keep
 * exact teardown bookkeeping:
 *   - `HOST_CREATED|<prefix>`   a proxy host route was added
 *   - `DEFAULT4_CREATED`        the IPv4 default route via TUN was added
 *   - `DEFAULT6_CREATED`        the IPv6 default route via TUN was added
 *   - `TUN_ADDR_WARN|<msg>`     setting the TUN address failed (non-fatal)
 *   - `HOST_FAIL|<prefix>|<msg>` a host route could not be added (non-fatal)
 *   - `DEFAULT_FAIL|<msg>` + exit 1 when the default route never succeeded
 */
export const enableTunRoutingScript = (
  params: EnableTunRoutingParams,
): string => {
  const {
    tunInterfaceIndex,
    defaultRouteInterfaceIndex,
    gateway,
    proxyHostPrefixes,
    hostRouteMetric,
    defaultRouteRetries,
    defaultRouteRetryDelayMs,
  } = params;
  validateInterfaceIndex(tunInterfaceIndex);
  validateInterfaceIndex(defaultRouteInterfaceIndex);
  validateIpOrPrefix(gateway);
  validateMetric(hostRouteMetric);
  proxyHostPrefixes.forEach(validateIpOrPrefix);
  validateRetryCount(defaultRouteRetries);
  validateRetryDelay(defaultRouteRetryDelayMs);

  const dnsServers = TUN_DNS_SERVERS.map((server) => `"${server}"`).join(', ');
  const prefixesLiteral = proxyHostPrefixes
    .map((prefix) => `'${prefix}'`)
    .join(', ');

  return `
      $proxyPrefixes = @(${prefixesLiteral})

      # 1) Remove stale proxy host routes at the host metric so we can re-add cleanly.
      foreach ($p in $proxyPrefixes) {
        Get-NetRoute -DestinationPrefix $p -ErrorAction SilentlyContinue |
          Where-Object { $_.RouteMetric -eq ${hostRouteMetric} } |
          Remove-NetRoute -Confirm:$false -ErrorAction SilentlyContinue
      }

      # 2) Ensure the TUN adapter address + DNS (best-effort; Xray may already have set it).
      try {
        $existing4 = Get-NetIPAddress -InterfaceIndex ${tunInterfaceIndex} -AddressFamily IPv4 -ErrorAction SilentlyContinue | Select-Object -First 1
        if (-not $existing4) {
          New-NetIPAddress -InterfaceIndex ${tunInterfaceIndex} -IPAddress ${TUN_ADDRESS} -PrefixLength ${TUN_PREFIX} -ErrorAction Stop | Out-Null
        }
        $existing6 = Get-NetIPAddress -InterfaceIndex ${tunInterfaceIndex} -AddressFamily IPv6 -ErrorAction SilentlyContinue |
          Where-Object { $_.IPAddress -eq "${TUN_IPV6_ADDRESS}" } | Select-Object -First 1
        if (-not $existing6) {
          New-NetIPAddress -InterfaceIndex ${tunInterfaceIndex} -IPAddress "${TUN_IPV6_ADDRESS}" -PrefixLength ${TUN_IPV6_PREFIX} -ErrorAction Stop | Out-Null
        }
        Set-DnsClientServerAddress -InterfaceIndex ${tunInterfaceIndex} -ServerAddresses @(${dnsServers}) -ErrorAction Stop
      } catch {
        Write-Output ("TUN_ADDR_WARN|" + $_.Exception.Message)
      }

      # 3) Pin proxy server IPs to the physical gateway so tunnel traffic can escape.
      foreach ($p in $proxyPrefixes) {
        $existingHost = Get-NetRoute -DestinationPrefix $p -InterfaceIndex ${defaultRouteInterfaceIndex} -ErrorAction SilentlyContinue | Select-Object -First 1
        if (-not $existingHost) {
          try {
            New-NetRoute -DestinationPrefix $p -NextHop "${gateway}" -InterfaceIndex ${defaultRouteInterfaceIndex} -RouteMetric ${hostRouteMetric} -ErrorAction Stop | Out-Null
            Write-Output ("HOST_CREATED|" + $p)
          } catch {
            Write-Output ("HOST_FAIL|" + $p + "|" + $_.Exception.Message)
          }
        }
      }

      # 4) Point the default route at the TUN interface, retrying transient failures.
      $tunIdx = ${tunInterfaceIndex}
      $v4done = $false
      $v6done = $false
      $attempt = 0
      $lastErr = ''
      while ($attempt -lt ${defaultRouteRetries} -and -not ($v4done -and $v6done)) {
        $attempt++
        try {
          if (-not $v4done) {
            $e4 = Get-NetRoute -DestinationPrefix "0.0.0.0/0" -InterfaceIndex $tunIdx -ErrorAction SilentlyContinue
            if (-not $e4) {
              New-NetRoute -DestinationPrefix "0.0.0.0/0" -NextHop "${TUN_NEXTHOP}" -InterfaceIndex $tunIdx -RouteMetric ${TUN_ROUTE_METRIC} -ErrorAction Stop | Out-Null
              Write-Output "DEFAULT4_CREATED"
            }
            $v4done = $true
          }
          if (-not $v6done) {
            $e6 = Get-NetRoute -DestinationPrefix "::/0" -InterfaceIndex $tunIdx -ErrorAction SilentlyContinue
            if (-not $e6) {
              New-NetRoute -DestinationPrefix "::/0" -NextHop "${TUN_IPV6_NEXTHOP}" -InterfaceIndex $tunIdx -RouteMetric ${TUN_ROUTE_METRIC} -ErrorAction Stop | Out-Null
              Write-Output "DEFAULT6_CREATED"
            }
            $v6done = $true
          }
        } catch {
          $lastErr = $_.Exception.Message
          Start-Sleep -Milliseconds ${defaultRouteRetryDelayMs}
        }
      }
      if (-not ($v4done -and $v6done)) {
        Write-Output ("DEFAULT_FAIL|" + $lastErr)
        exit 1
      }
    `;
};

export const deleteRouteScript = (
  prefix: string,
  interfaceIndex?: number,
): string => {
  validateIpOrPrefix(prefix);
  validateInterfaceIndex(interfaceIndex);
  const ifPart =
    interfaceIndex != null ? ` -InterfaceIndex ${interfaceIndex}` : '';
  return `
      Remove-NetRoute -DestinationPrefix "${prefix}"${ifPart} -ErrorAction SilentlyContinue
    `;
};

export const deleteRouteByPrefixAndMetricScript = (
  destinationPrefix: string,
  metric: number,
  interfaceIndex?: number,
): string => {
  validateIpOrPrefix(destinationPrefix);
  validateMetric(metric);
  validateInterfaceIndex(interfaceIndex);
  const ifPart =
    interfaceIndex != null ? ` -InterfaceIndex ${interfaceIndex}` : '';
  return `
      Get-NetRoute -DestinationPrefix "${destinationPrefix}"${ifPart} -ErrorAction SilentlyContinue |
        Where-Object { $_.RouteMetric -eq ${metric} } |
        Remove-NetRoute -Confirm:$false -ErrorAction SilentlyContinue
    `;
};

export const deleteTunDefaultRoutesByNextHopScript = (
  nextHop: string,
  metric: number,
  destinationPrefix: string = '0.0.0.0/0',
): string => {
  validateIpOrPrefix(nextHop);
  validateIpOrPrefix(destinationPrefix);
  validateMetric(metric);
  return `
      Get-NetRoute -DestinationPrefix "${destinationPrefix}" -ErrorAction SilentlyContinue |
        Where-Object {
          $_.RouteMetric -eq ${metric} -and $_.NextHop -eq "${nextHop}"
        } |
        Remove-NetRoute -Confirm:$false -ErrorAction SilentlyContinue
    `;
};

export const deleteHostRoutesByPrefixesAndMetricScript = (
  destinationPrefixes: string[],
  metric: number,
): string => {
  destinationPrefixes.forEach(validateIpOrPrefix);
  validateMetric(metric);
  const prefixesLiteral = destinationPrefixes
    .map((prefix) => `'${prefix}'`)
    .join(', ');
  return `
      $targets = @(${prefixesLiteral})
      $targetSet = @{}
      foreach ($target in $targets) {
        $targetSet[$target] = $true
      }
      $removed = 0
      foreach ($target in $targets) {
        Get-NetRoute -DestinationPrefix $target -ErrorAction SilentlyContinue |
          Where-Object {
            $_.RouteMetric -eq ${metric} -and $targetSet.ContainsKey($_.DestinationPrefix)
          } |
          ForEach-Object {
            Remove-NetRoute -DestinationPrefix $_.DestinationPrefix -InterfaceIndex $_.InterfaceIndex -NextHop $_.NextHop -Confirm:$false -ErrorAction SilentlyContinue
            $removed++
          }
      }
      Write-Output $removed
    `;
};
