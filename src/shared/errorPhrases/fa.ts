import type { ErrorPhrases } from './patterns';

export const fa: ErrorPhrases = {
  // Xray process
  configGenerationFailed: 'خطا در پیکربندی سرور: ',
  xrayBinaryNotFound: 'فایل اجرایی Xray پیدا نشد: ',
  portInUse:
    'پورت $<port> روی 127.0.0.1 را برنامهٔ دیگری استفاده می‌کند (VPN یا کلاینت پراکسی دیگری؟). آن را ببندید و دوباره وصل شوید.',
  portUnavailable: 'پورت $<port> روی 127.0.0.1 در دسترس نیست ($<code>).',
  xrayExitedAtStartup:
    'Xray هنگام راه‌اندازی بسته شد (کد $<code>، سیگنال $<signal>)',
  xrayExitedUnexpectedly:
    'Xray به‌طور غیرمنتظره بسته شد (کد $<code>، سیگنال $<signal>)',
  xrayExitedBeforeListeners: 'Xray پیش از باز شدن پورت‌های محلی پراکسی بسته شد',
  listenersUnreachable: 'پورت‌های محلی پراکسی در دسترس نیستند',
  xrayHealthFailed: 'Xray خرابی گزارش کرد',

  // Connection and health checks
  connectionError: 'خطای اتصال: ',
  connectionFailed: 'اتصال برقرار نشد',
  disconnected: 'قطع شد',
  connectedTo: 'متصل به $<name>',
  switchingFromTo: 'تعویض از $<from> به $<to>',
  switchingTo: 'تعویض به $<name>',
  remoteCheckFailed:
    'بررسی دسترسی به اینترنت از طریق تونل پس از چند تلاش ناموفق بود (تونل کند یا مسدود است)',
  hostOffline: 'بدون VPN هم اینترنت در دسترس نیست؛ تعویض خودکار به تعویق افتاد',
  postSwitchCheckFailed: 'پس از تعویض سرور، ترافیک عبور نمی‌کند',
  serverNotFound: 'سرور انتخاب‌شده در فهرست پیدا نشد',
  autoSwitchOffline: 'تعویض خودکار متوقف شد: اینترنت در دسترس نیست',
  autoSwitchTimeUp: 'تعویض خودکار متوقف شد: زمان تعیین‌شده تمام شد',
  autoSwitchNoServers: 'تعویض خودکار ناموفق بود: سرور سالمی پیدا نشد',
  autoSwitchFailed: 'تعویض خودکار ناموفق بود',

  // TUN and system proxy
  tunUnsupported: 'حالت TUN در این سیستم‌عامل پشتیبانی نمی‌شود.',
  tunNeedsAdmin:
    'حالت TUN به دسترسی مدیر (Administrator) نیاز دارد. درخواست UAC را تأیید کنید یا UltimaVLESS را با دسترسی مدیر اجرا کنید.',
  tunNeedsPolkit:
    'حالت TUN به دسترسی بالاتر نیاز دارد. یک عامل PolicyKit (pkexec) نصب کنید تا UltimaVLESS هنگام اتصال آن را درخواست کند، یا UltimaVLESS را با root اجرا کنید.',
  tunNeedsRoot:
    'در این سیستم‌عامل حالت TUN به دسترسی root نیاز دارد. برنامه را با دسترسی بالاتر اجرا کنید.',
  tunAuthDeclined:
    'حالت TUN به دسترسی بالاتر نیاز دارد، اما درخواست رد یا بسته شد.',

  // Android VpnService
  vpnPermissionDenied:
    'اجازهٔ VPN داده نشده است: هنگام اتصال درخواست Android را تأیید کنید',
  vpnRevoked: 'VPN خاموش شد: کلاینت VPN دیگری تونل را در اختیار گرفت',
  vpnServiceStopped: 'سرویس VPN توسط سیستم متوقف شد',
  localProxyNotOpened: 'Xray پراکسی محلی را روی 127.0.0.1:$<port> باز نکرد',
  tunRootPrepareFailed:
    'حالت TUN نتوانست Xray را برای اجرا با root آماده کند: ',
  tunRootCopyFailed: 'حالت TUN نتوانست نسخه‌ای از Xray متعلق به root بسازد',
  tunRootCopyMismatch:
    'حالت TUN، Xray را اجرا نکرد: این نسخه با نسخهٔ همراه UltimaVLESS یکسان نیست',
  tunRootRunFailed: 'حالت TUN نتوانست Xray را با root اجرا کند',
  tunAdapterNoGateway:
    'آداپتور شبکهٔ «$<name>» که برای TUN انتخاب شده، دروازهٔ پیش‌فرض IPv4 ندارد (قطع است یا به اینترنت وصل نیست). در «تنظیمات ← شبکه» آداپتور دیگری انتخاب کنید یا آن را روی «خودکار» بگذارید.',
  noDefaultRoute: 'مسیر پیش‌فرض پیدا نشد. اتصال شبکه را بررسی کنید.',
  proxyResolveFailed: 'نشانی IP سرور به دست نیامد: ',
  modeChangeWhileConnecting:
    'پیش از تغییر حالت اتصال، صبر کنید تا اتصال کامل شود.',
  linuxProxyNeedsGnome:
    'برای پراکسی سیستم در Linux به محیط دسکتاپ سازگار با GNOME و ابزار gsettings نیاز است.',
  linuxProxyEnableFailed: 'پراکسی سیستم با gsettings روشن نشد: ',
  linuxProxyDisableFailed: 'پراکسی سیستم با gsettings خاموش نشد: ',
  macNoNetworkServices:
    'هیچ سرویس شبکهٔ macOS برای تنظیم پراکسی سیستم پیدا نشد.',

  // Server profile vs bundled Xray
  trojanNeedsTls:
    'Xray $<version> بدون TLS یا REALITY از طریق Trojan به نشانی عمومی وصل نمی‌شود. security=tls یا security=reality را تنظیم کنید.',
  vlessNeedsTls:
    'Xray $<version> بدون TLS، REALITY یا VLESS Encryption از طریق VLESS به نشانی عمومی وصل نمی‌شود. security=tls یا security=reality را تنظیم کنید.',
  hysteriaNeedsTls:
    'در Xray $<version>، Hysteria فقط با TLS کار می‌کند (streamSettings.security=tls).',
  allowInsecureRemoved:
    'در Xray $<version> پارامتر «allowInsecure» حذف شده است؛ به‌جای آن از pinnedPeerCertSha256 (pcs) و/یا verifyPeerCertByName (vcn) استفاده کنید.',
  ssMethodRemoved:
    'روش Shadowsocks «$<method>» در Xray $<version> حذف شده است؛ از رمز AEAD استفاده کنید (مثلاً aes-128-gcm یا chacha20-poly1305).',
  ssMethodRequired: 'روش رمزگذاری Shadowsocks مشخص نشده است.',
  httpTransportUnsupported:
    'انتقال HTTP در Xray $<version> پشتیبانی نمی‌شود؛ از XHTTP استفاده کنید.',
  quicTransportUnsupported:
    'انتقال QUIC در Xray $<version> پشتیبانی نمی‌شود؛ از XHTTP/H3 استفاده کنید.',
  realityTransport:
    'REALITY فقط با انتقال‌های RAW/TCP، XHTTP و gRPC کار می‌کند.',
  hysteriaNeedsAuth: 'Hysteria به گذرواژه (hysteriaAuth) نیاز دارد.',
  wgNeedsKey: 'WireGuard به کلید خصوصی (wgSecretKey) نیاز دارد.',
  wgNeedsAddress: 'WireGuard به نشانی رابط (wgAddress) نیاز دارد.',
  wgNeedsPeer: 'WireGuard دست‌کم به یک همتا (peer) نیاز دارد.',
  rawConfigNeedsProxy:
    'پیکربندی JSON به یک outbound با برچسب «proxy» و پروتکل تونل نیاز دارد.',

  // Subscriptions
  subscriptionNoLinks: 'در اشتراک هیچ پیوند سرور معتبری نیست',
  noValidLinks: 'هیچ پیوند سرور معتبری پیدا نشد',
  manualNoValidLinks: 'هیچ‌کدام از پیوندهای افزوده‌شدهٔ دستی معتبر نیست',
  subscriptionHttpError: 'سرور اشتراک با خطای HTTP $<status> پاسخ داد',
  subscriptionTimeout: 'سرور اشتراک در $<seconds> ثانیه پاسخ نداد',
  subscriptionUnreachable: 'ارتباط با سرور اشتراک برقرار نشد ($<code>)',
  subscriptionTooLarge: 'پاسخ اشتراک بیش از حد بزرگ است',
  subscriptionEmpty: 'اشتراک پاسخ خالی برگرداند',
  subscriptionBadBase64: 'اشتراک دادهٔ خراب برگرداند (خطای Base64)',
  subscriptionHtmlPage: 'نشانی اشتراک یک صفحهٔ HTML بدون پیوند سرور باز کرد',
  subscriptionPrivateIp: 'نشانی اشتراک به یک IP محلی اشاره می‌کند',
  subscriptionHostNotAllowed: 'این نشانی اشتراک مجاز نیست',
  subscriptionNoAddress: 'نشانی IP سرور اشتراک پیدا نشد',
  subscriptionDnsFailed:
    'نشانی سرور اشتراک تأیید نشد (پرس‌وجوی DNS ناموفق بود یا زمانش تمام شد)',
  subscriptionTooManyRedirects:
    'هنگام بارگیری اشتراک تغییر مسیر بیش از حد رخ داد (حداکثر $<max>)',
  subscriptionRedirectNoLocation:
    'سرور اشتراک تغییر مسیری بدون نشانی برگرداند (HTTP $<status>)',
  subscriptionHttpsOnly: 'فقط نشانی‌های اشتراک با HTTPS مجاز هستند',
  happEncryptedLink:
    'این یک پیوند رمزگذاری‌شدهٔ Happ است (happ://crypt…): فقط برنامهٔ Happ می‌تواند آن را باز کند. از ارائه‌دهنده یک پیوند اشتراک معمولی بخواهید که با https:// شروع شود',
  subscriptionInvalidUrl: 'نشانی اشتراک نامعتبر است',
  subscriptionNameRequired: 'نام اشتراک را وارد کنید',
  subscriptionUrlRequired: 'نشانی اشتراک را وارد کنید',
  subscriptionNameTooLong:
    'نام اشتراک بیش از حد طولانی است (حداکثر $<max> نویسه)',
  subscriptionUrlTooLong:
    'نشانی اشتراک بیش از حد طولانی است (حداکثر $<max> نویسه)',
  manualLinksTooLarge: 'متن پیوندها بیش از حد زیاد است (حداکثر $<max> نویسه)',
};
