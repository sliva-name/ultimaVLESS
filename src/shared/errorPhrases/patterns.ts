/**
 * The English phrases the main process writes, one entry per translatable
 * phrase. Translations live next to this file, one per language, keyed by
 * the same ids, and may use the named groups (`$<port>`).
 *
 * Order matters: a longer phrase goes before a shorter one it contains
 * ("…in the subscription" before "…were found", "Switching from" before
 * "Switching to").
 *
 * Only what the user sees is translated: the English text stays in logs and
 * in the checks that read it (`blockingErrors.ts`).
 */

const VERSION = String.raw`(?<version>v?\d+(?:\.\d+)*)`;

/** A phrase that names the bundled Xray version (`$<version>`). */
const withVersion = (source: string) => new RegExp(source, 'g');

export const ERROR_PATTERNS = {
  // Xray process
  configGenerationFailed: /Config generation failed: /g,
  xrayBinaryNotFound: /Xray binary not found at: /g,
  portInUse:
    /Port (?<port>\d+) on 127\.0\.0\.1 is already used by another program \(another VPN or proxy client\?\)\. Close it and connect again\./g,
  portUnavailable:
    /Port (?<port>\d+) on 127\.0\.0\.1 cannot be used \((?<code>[^)]+)\)\./g,
  xrayExitedAtStartup:
    /Xray exited during startup \(code=(?<code>[^,]+), signal=(?<signal>[^)]+)\)/g,
  xrayExitedUnexpectedly:
    /Xray exited unexpectedly \(code=(?<code>[^,]+), signal=(?<signal>[^)]+)\)/g,
  xrayExitedBeforeListeners:
    /Xray process exited before local proxy listeners became ready/g,
  listenersUnreachable: /Local proxy listeners are unreachable/g,
  xrayHealthFailed: /Xray reported failed health status/g,

  // Connection and health checks
  connectionError: /Connection error: /g,
  connectionFailed: /^Connection failed$/g,
  disconnected: /^Disconnected$/g,
  connectedTo: /^Connected to (?<name>.+)$/g,
  switchingFromTo: /^Switching from (?<from>.+) to (?<to>.+)$/g,
  switchingTo: /^Switching to (?<name>.+)$/g,
  remoteCheckFailed:
    /Remote endpoint check via proxy failed after retries \(tunnel may be slow or blocked\)/g,
  hostOffline:
    /Host internet connectivity is unavailable; auto-switch is deferred/g,
  postSwitchCheckFailed: /Post-switch traffic validation failed/g,
  serverNotFound: /Selected server was not found in local configuration/g,
  autoSwitchOffline: /Auto-switch aborted: host internet unavailable/g,
  autoSwitchTimeUp: /Auto-switch stopped: time budget exhausted/g,
  autoSwitchNoServers: /Auto-switch failed: no working servers found/g,
  autoSwitchFailed: /^Auto-switch failed$/g,

  // TUN and system proxy
  tunUnsupported: /TUN mode is not supported on this operating system\./g,
  tunNeedsAdmin:
    /TUN mode requires Administrator rights\. Please approve UAC prompt or run UltimaVLESS as Administrator\./g,
  tunNeedsPolkit:
    /TUN mode needs elevated privileges\. Install a PolicyKit agent \(pkexec\) so UltimaVLESS can request them at connect time, or run UltimaVLESS as root\./g,
  tunNeedsRoot:
    /TUN mode requires root privileges on this operating system\. Please run the app with elevated permissions\./g,
  tunAuthDeclined:
    /TUN mode requires elevated privileges, but the authorization request was declined or dismissed\./g,

  // Android VpnService
  vpnPermissionDenied: /VPN permission was denied/g,
  vpnRevoked: /VPN was turned off by another VPN app/g,
  vpnServiceStopped: /VPN service stopped/g,
  localProxyNotOpened:
    /Xray did not open the local proxy on 127\.0\.0\.1:(?<port>\d+)/g,
  tunRootPrepareFailed: /TUN mode could not prepare Xray for root: /g,
  tunRootCopyFailed: /TUN mode could not make a root-owned copy of Xray/g,
  tunRootCopyMismatch:
    /TUN mode refused to run Xray: its copy does not match the one shipped with UltimaVLESS/g,
  tunRootRunFailed: /TUN mode could not run Xray as root/g,
  tunAdapterNoGateway:
    /Network adapter "(?<name>[^"]*)" selected for TUN has no IPv4 default gateway \(disconnected, or not an internet connection\)\. Choose another adapter in Settings → Network or set it to Automatic\./g,
  noDefaultRoute: /Could not get default route\. Check network connection\./g,
  proxyResolveFailed: /Could not resolve proxy server address: /g,
  modeChangeWhileConnecting:
    /Wait for the connection to finish before changing connection mode\./g,
  linuxProxyNeedsGnome:
    /Linux system proxy control currently requires a GNOME-compatible desktop with gsettings available\./g,
  linuxProxyEnableFailed:
    /Failed to enable Linux system proxy via gsettings: /g,
  linuxProxyDisableFailed:
    /Failed to disable Linux system proxy via gsettings: /g,
  macNoNetworkServices:
    /No macOS network services found for system proxy configuration\./g,

  // Server profile vs bundled Xray
  trojanNeedsTls: withVersion(
    String.raw`Trojan requires TLS \(or REALITY\) for public server addresses in Xray ${VERSION}\. Set security=tls or security=reality\.`,
  ),
  vlessNeedsTls: withVersion(
    String.raw`VLESS requires TLS/REALITY \(or VLESS Encryption\) for public server addresses in Xray ${VERSION}\. Set security=tls or security=reality\.`,
  ),
  hysteriaNeedsTls: withVersion(
    String.raw`Hysteria requires streamSettings\.security=tls in Xray ${VERSION}\.`,
  ),
  allowInsecureRemoved: withVersion(
    String.raw`"allowInsecure" was removed in bundled Xray ${VERSION}; use pinnedPeerCertSha256 \(pcs\) and/or verifyPeerCertByName \(vcn\) instead\.`,
  ),
  ssMethodRemoved: withVersion(
    String.raw`Shadowsocks method "(?<method>[^"]*)" was removed in Xray ${VERSION}; use an AEAD cipher \(e\.g\. aes-128-gcm, chacha20-poly1305\)\.`,
  ),
  ssMethodRequired: /Shadowsocks method is required\./g,
  httpTransportUnsupported: withVersion(
    String.raw`HTTP transport is not supported by bundled Xray ${VERSION}; use XHTTP instead\.`,
  ),
  quicTransportUnsupported: withVersion(
    String.raw`QUIC transport is not supported by bundled Xray ${VERSION}; use XHTTP/H3 instead\.`,
  ),
  realityTransport: /REALITY transport requires RAW\/TCP, XHTTP, or gRPC\./g,
  hysteriaNeedsAuth:
    /Hysteria outbound requires hysteriaAuth \(or password\)\./g,
  wgNeedsKey: /WireGuard outbound requires wgSecretKey\./g,
  wgNeedsAddress: /WireGuard outbound requires wgAddress\./g,
  wgNeedsPeer: /WireGuard outbound requires at least one peer\./g,
  rawConfigNeedsProxy:
    /Raw config must include an outbound tagged "proxy" with a tunnel protocol\./g,

  // Subscriptions
  subscriptionNoLinks:
    /No valid configuration links were found in the subscription/g,
  noValidLinks: /No valid configuration links were found/g,
  manualNoValidLinks: /No valid configs found in manual links/g,
  subscriptionHttpError: /Subscription request failed: HTTP (?<status>\d+)/g,
  subscriptionTimeout:
    /Subscription server did not respond within (?<seconds>\d+)s/g,
  subscriptionUnreachable:
    /Could not reach the subscription server \((?<code>[^)]+)\)/g,
  subscriptionTooLarge: /Subscription response is too large/g,
  subscriptionEmpty: /Empty response from subscription URL/g,
  subscriptionBadBase64: /Invalid Base64 response/g,
  subscriptionHtmlPage:
    /Subscription URL returned an HTML page without proxy links/g,
  subscriptionPrivateIp: /Subscription URL resolves to a private IP/g,
  subscriptionHostNotAllowed: /Subscription URL host is not allowed/g,
  subscriptionNoAddress: /Subscription URL did not resolve to any address/g,
  subscriptionDnsFailed:
    /Could not verify the subscription host address \(DNS lookup failed or timed out\)/g,
  subscriptionTooManyRedirects:
    /Too many redirects while fetching subscription \(max (?<max>\d+)\)/g,
  subscriptionRedirectNoLocation:
    /Redirect response missing Location header: HTTP (?<status>\d+)/g,
  subscriptionHttpsOnly: /Only HTTPS subscription URLs are allowed/g,
  happEncryptedLink:
    /This is an encrypted Happ link \(happ:\/\/crypt…\): only the Happ app can open it\. Ask your provider for a regular subscription link starting with https:\/\//g,
  subscriptionInvalidUrl: /Invalid subscription URL/g,
  subscriptionNameRequired: /Subscription name is required/g,
  subscriptionUrlRequired: /Subscription URL is required/g,
  subscriptionNameTooLong:
    /Subscription name is too long \(max (?<max>\d+) characters\)/g,
  subscriptionUrlTooLong:
    /Subscription URL is too long \(max (?<max>\d+) characters\)/g,
  manualLinksTooLarge:
    /Manual links payload is too large \(max (?<max>\d+) characters\)/g,
} as const satisfies Record<string, RegExp>;

export type ErrorPhraseId = keyof typeof ERROR_PATTERNS;

/** One language's wording for every phrase. */
export type ErrorPhrases = Readonly<Record<ErrorPhraseId, string>>;
