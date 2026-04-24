import {
  TUN_ADDRESS,
  TUN_INTERFACE_NAME,
  TUN_NEXTHOP,
  TUN_PREFIX,
  TUN_ROUTE_METRIC,
  TUN_WAIT_INTERVAL,
  TUN_WAIT_TIMEOUT,
} from './constants';

function validateIpOrPrefix(val: string): void {
  // Allows IPv4, IPv6, and CIDR notation
  if (!/^[a-fA-F0-9.:/]+$/.test(val)) {
    throw new Error(`Invalid IP or prefix format: ${val}`);
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

export const ensureTunAddressScript = (tunInterfaceIndex: number): string => `
      $existing = Get-NetIPAddress -InterfaceIndex ${tunInterfaceIndex} -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Select-Object -First 1
      if (-not $existing) {
        New-NetIPAddress -InterfaceIndex ${tunInterfaceIndex} -IPAddress ${TUN_ADDRESS} -PrefixLength ${TUN_PREFIX} -ErrorAction Stop
      }
    `;

export const addRouteScript = (
  destPrefix: string,
  gateway: string,
  metric: number,
  interfaceIndex?: number
): string => {
  validateIpOrPrefix(destPrefix);
  validateIpOrPrefix(gateway);
  const ifPart = interfaceIndex != null ? ` -InterfaceIndex ${interfaceIndex}` : '';
  return `
      $existing = Get-NetRoute -DestinationPrefix "${destPrefix}"${ifPart} -ErrorAction SilentlyContinue | Select-Object -First 1
      if (-not $existing) {
        New-NetRoute -DestinationPrefix "${destPrefix}" -NextHop "${gateway}"${ifPart} -RouteMetric ${metric} -ErrorAction Stop
        Write-Output "CREATED"
      }
    `;
};

export const addDefaultRouteViaTunScript = (tunIdx: number): string => `
          $existing = Get-NetRoute -DestinationPrefix "0.0.0.0/0" -InterfaceIndex ${tunIdx} -ErrorAction SilentlyContinue
          if (-not $existing) {
            New-NetRoute -DestinationPrefix "0.0.0.0/0" -NextHop "${TUN_NEXTHOP}" -InterfaceIndex ${tunIdx} -RouteMetric ${TUN_ROUTE_METRIC} -ErrorAction Stop
            Write-Output "CREATED"
          }
        `;

export const deleteRouteScript = (prefix: string, interfaceIndex?: number): string => {
  validateIpOrPrefix(prefix);
  const ifPart = interfaceIndex != null ? ` -InterfaceIndex ${interfaceIndex}` : '';
  return `
      Remove-NetRoute -DestinationPrefix "${prefix}"${ifPart} -ErrorAction SilentlyContinue
    `;
};

export const deleteRouteByPrefixAndMetricScript = (
  destinationPrefix: string,
  metric: number,
  interfaceIndex?: number
): string => {
  validateIpOrPrefix(destinationPrefix);
  const ifPart = interfaceIndex != null ? ` -InterfaceIndex ${interfaceIndex}` : '';
  return `
      Get-NetRoute -DestinationPrefix "${destinationPrefix}"${ifPart} -ErrorAction SilentlyContinue |
        Where-Object { $_.RouteMetric -eq ${metric} } |
        Remove-NetRoute -Confirm:$false -ErrorAction SilentlyContinue
    `;
};

export const deleteTunDefaultRoutesByNextHopScript = (nextHop: string, metric: number): string => {
  validateIpOrPrefix(nextHop);
  return `
      Get-NetRoute -DestinationPrefix "0.0.0.0/0" -ErrorAction SilentlyContinue |
        Where-Object {
          $_.RouteMetric -eq ${metric} -and $_.NextHop -eq "${nextHop}"
        } |
        Remove-NetRoute -Confirm:$false -ErrorAction SilentlyContinue
    `;
};

export const deleteHostRoutesByPrefixesAndMetricScript = (
  destinationPrefixes: string[],
  metric: number
): string => {
  destinationPrefixes.forEach(validateIpOrPrefix);
  const prefixesLiteral = destinationPrefixes.map((prefix) => `'${prefix}'`).join(', ');
  return `
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
};
