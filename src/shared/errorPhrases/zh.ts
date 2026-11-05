import type { ErrorPhrases } from './patterns';

export const zh: ErrorPhrases = {
  // Xray process
  configGenerationFailed: '服务器配置有误：',
  xrayBinaryNotFound: '未找到 Xray 可执行文件：',
  portInUse:
    '127.0.0.1 上的端口 $<port> 已被其他程序占用（其他 VPN 或代理客户端？）。请关闭它后重新连接。',
  portUnavailable: '127.0.0.1 上的端口 $<port> 不可用（$<code>）。',
  xrayExitedAtStartup: 'Xray 在启动时退出（代码 $<code>，信号 $<signal>）',
  xrayExitedUnexpectedly: 'Xray 意外退出（代码 $<code>，信号 $<signal>）',
  xrayExitedBeforeListeners: 'Xray 在本地代理端口打开之前就退出了',
  listenersUnreachable: '本地代理端口无法访问',
  xrayHealthFailed: 'Xray 报告了故障',

  // Connection and health checks
  connectionError: '连接错误：',
  connectionFailed: '连接失败',
  disconnected: '已断开连接',
  connectedTo: '已连接到 $<name>',
  switchingFromTo: '正在从 $<from> 切换到 $<to>',
  switchingTo: '正在切换到 $<name>',
  remoteCheckFailed:
    '多次尝试后，经隧道访问互联网的检查仍未通过（隧道较慢或已被封锁）',
  hostOffline: '不使用 VPN 也无法访问互联网；自动切换已推迟',
  postSwitchCheckFailed: '更换服务器后流量无法通过',
  serverNotFound: '列表中找不到所选服务器',
  autoSwitchOffline: '自动切换已中止：无法访问互联网',
  autoSwitchTimeUp: '自动切换已停止：时间已用尽',
  autoSwitchNoServers: '自动切换失败：未找到可用的服务器',
  autoSwitchFailed: '自动切换失败',

  // TUN and system proxy
  tunUnsupported: '此操作系统不支持 TUN 模式。',
  tunNeedsAdmin:
    'TUN 模式需要管理员权限。请确认 UAC 提示，或以管理员身份运行 UltimaVLESS。',
  tunNeedsPolkit:
    'TUN 模式需要提升的权限。请安装 PolicyKit 代理（pkexec），以便 UltimaVLESS 在连接时请求权限，或以 root 身份运行 UltimaVLESS。',
  tunNeedsRoot:
    '在此操作系统上，TUN 模式需要 root 权限。请以提升的权限运行应用。',
  tunAuthDeclined: 'TUN 模式需要提升的权限，但授权请求被拒绝或关闭。',

  // Android VpnService
  vpnPermissionDenied: '没有 VPN 权限：请在连接时确认 Android 的请求',
  vpnRevoked: 'VPN 已关闭：隧道被其他 VPN 客户端占用',
  vpnServiceStopped: 'VPN 服务已被系统停止',
  localProxyNotOpened: 'Xray 未在 127.0.0.1:$<port> 上打开本地代理',
  tunRootPrepareFailed: 'TUN 模式无法为以 root 运行准备 Xray：',
  tunRootCopyFailed: 'TUN 模式无法创建属于 root 的 Xray 副本',
  tunRootCopyMismatch: 'TUN 模式未运行 Xray：该副本与 UltimaVLESS 自带的不一致',
  tunRootRunFailed: 'TUN 模式无法以 root 身份运行 Xray',
  tunAdapterNoGateway:
    '为 TUN 选择的网络适配器“$<name>”没有 IPv4 默认网关（已断开，或不是互联网连接）。请在“设置 → 网络”中选择其他适配器，或设为“自动”。',
  noDefaultRoute: '找不到默认路由。请检查网络连接。',
  proxyResolveFailed: '无法解析代理服务器地址：',
  modeChangeWhileConnecting: '请等待连接完成后再更改连接模式。',
  linuxProxyNeedsGnome:
    '在 Linux 上控制系统代理需要兼容 GNOME 的桌面环境和 gsettings 工具。',
  linuxProxyEnableFailed: '无法通过 gsettings 启用系统代理：',
  linuxProxyDisableFailed: '无法通过 gsettings 关闭系统代理：',
  macNoNetworkServices: '未找到可用于配置系统代理的 macOS 网络服务。',

  // Server profile vs bundled Xray
  trojanNeedsTls:
    'Xray $<version> 不会在没有 TLS 或 REALITY 的情况下通过 Trojan 连接公共地址。请设置 security=tls 或 security=reality。',
  vlessNeedsTls:
    'Xray $<version> 不会在没有 TLS、REALITY 或 VLESS Encryption 的情况下通过 VLESS 连接公共地址。请设置 security=tls 或 security=reality。',
  hysteriaNeedsTls:
    '在 Xray $<version> 中，Hysteria 只能与 TLS 一起使用（streamSettings.security=tls）。',
  allowInsecureRemoved:
    'Xray $<version> 已移除“allowInsecure”参数；请改用 pinnedPeerCertSha256（pcs）和/或 verifyPeerCertByName（vcn）。',
  ssMethodRemoved:
    'Shadowsocks 加密方式“$<method>”已在 Xray $<version> 中移除；请使用 AEAD 加密（例如 aes-128-gcm 或 chacha20-poly1305）。',
  ssMethodRequired: '未指定 Shadowsocks 加密方式。',
  httpTransportUnsupported: 'Xray $<version> 不支持 HTTP 传输；请改用 XHTTP。',
  quicTransportUnsupported:
    'Xray $<version> 不支持 QUIC 传输；请改用 XHTTP/H3。',
  realityTransport: 'REALITY 只能与 RAW/TCP、XHTTP 或 gRPC 传输一起使用。',
  hysteriaNeedsAuth: 'Hysteria 需要密码（hysteriaAuth）。',
  wgNeedsKey: 'WireGuard 需要私钥（wgSecretKey）。',
  wgNeedsAddress: 'WireGuard 需要接口地址（wgAddress）。',
  wgNeedsPeer: 'WireGuard 至少需要一个对等端（peer）。',
  rawConfigNeedsProxy:
    'JSON 配置中需要一个带隧道协议、标签为“proxy”的 outbound。',

  // Subscriptions
  subscriptionNoLinks: '订阅中没有任何可用的服务器链接',
  noValidLinks: '未找到任何可用的服务器链接',
  manualNoValidLinks: '手动添加的链接中没有可用的链接',
  subscriptionHttpError: '订阅服务器返回了 HTTP $<status> 错误',
  subscriptionTimeout: '订阅服务器在 $<seconds> 秒内没有响应',
  subscriptionUnreachable: '无法连接到订阅服务器（$<code>）',
  subscriptionTooLarge: '订阅响应过大',
  subscriptionEmpty: '订阅返回了空响应',
  subscriptionBadBase64: '订阅返回了损坏的数据（Base64 错误）',
  subscriptionHtmlPage: '订阅地址打开的是一个没有服务器链接的 HTML 页面',
  subscriptionPrivateIp: '订阅地址指向本地 IP',
  subscriptionHostNotAllowed: '不允许使用此订阅地址',
  subscriptionNoAddress: '找不到订阅服务器的 IP 地址',
  subscriptionDnsFailed: '无法验证订阅服务器地址（DNS 查询失败或超时）',
  subscriptionTooManyRedirects: '加载订阅时重定向次数过多（最多 $<max> 次）',
  subscriptionRedirectNoLocation:
    '订阅服务器返回了没有目标地址的重定向（HTTP $<status>）',
  subscriptionHttpsOnly: '只允许使用 HTTPS 订阅地址',
  happEncryptedLink:
    '这是加密的 Happ 链接（happ://crypt…）：只有 Happ 应用才能打开。请向服务商索取以 https:// 开头的普通订阅链接',
  subscriptionInvalidUrl: '订阅地址无效',
  subscriptionNameRequired: '请填写订阅名称',
  subscriptionUrlRequired: '请填写订阅地址',
  subscriptionNameTooLong: '订阅名称过长（最多 $<max> 个字符）',
  subscriptionUrlTooLong: '订阅地址过长（最多 $<max> 个字符）',
  manualLinksTooLarge: '链接文本过多（最多 $<max> 个字符）',
};
