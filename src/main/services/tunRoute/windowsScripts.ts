import { TUN_INTERFACE_NAME } from './constants';

/**
 * Adapter aliases are free text (quotes, `$`, backticks, Cyrillic). Instead of
 * escaping them for a PowerShell string literal, the script decodes base64 —
 * whose alphabet cannot break out of the quotes.
 */
function powerShellStringFromBase64(value: string): string {
  const encoded = Buffer.from(value, 'utf8').toString('base64');
  return `[System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${encoded}'))`;
}

/**
 * PowerShell fallback for default route discovery, when `route print` and
 * `netsh` cannot be interpreted. Side-effect-free so it can be tested.
 */

/**
 * Prints `index|gateway|alias|localAddress` for the best default route, or —
 * with `preferredInterface` — for that adapter's default route only.
 */
export const getDefaultRouteScript = (preferredInterface?: string): string => `
      $preferredAlias = ${preferredInterface ? powerShellStringFromBase64(preferredInterface) : "''"}
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
        if ($preferredAlias -and $if.Name -ne $preferredAlias) {
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
