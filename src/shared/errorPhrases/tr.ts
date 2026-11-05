import type { ErrorPhrases } from './patterns';

export const tr: ErrorPhrases = {
  // Xray process
  configGenerationFailed: 'Sunucu yapılandırmasında hata: ',
  xrayBinaryNotFound: 'Xray çalıştırılabilir dosyası bulunamadı: ',
  portInUse:
    '127.0.0.1 üzerindeki $<port> portunu başka bir program kullanıyor (başka bir VPN veya proxy istemcisi mi?). Onu kapatıp yeniden bağlanın.',
  portUnavailable:
    '127.0.0.1 üzerindeki $<port> portu kullanılamıyor ($<code>).',
  xrayExitedAtStartup:
    'Xray başlatılırken kapandı (kod $<code>, sinyal $<signal>)',
  xrayExitedUnexpectedly:
    'Xray beklenmedik şekilde kapandı (kod $<code>, sinyal $<signal>)',
  xrayExitedBeforeListeners:
    'Xray, yerel proxy portları açılmadan önce kapandı',
  listenersUnreachable: 'Yerel proxy portlarına erişilemiyor',
  xrayHealthFailed: 'Xray bir arıza bildirdi',

  // Connection and health checks
  connectionError: 'Bağlantı hatası: ',
  connectionFailed: 'Bağlanılamadı',
  disconnected: 'Bağlantı kesildi',
  connectedTo: '$<name> sunucusuna bağlanıldı',
  switchingFromTo: '$<from> sunucusundan $<to> sunucusuna geçiliyor',
  switchingTo: '$<name> sunucusuna geçiliyor',
  remoteCheckFailed:
    'Tünel üzerinden internet erişimi kontrolü birkaç denemeden sonra başarısız oldu (tünel yavaş veya engellenmiş)',
  hostOffline: 'VPN olmadan da internet yok; otomatik geçiş ertelendi',
  postSwitchCheckFailed: 'Sunucu değiştirildikten sonra trafik geçmiyor',
  serverNotFound: 'Seçilen sunucu listede bulunamadı',
  autoSwitchOffline: 'Otomatik geçiş durduruldu: internet erişimi yok',
  autoSwitchTimeUp: 'Otomatik geçiş durduruldu: ayrılan süre doldu',
  autoSwitchNoServers: 'Otomatik geçiş başarısız: çalışan sunucu bulunamadı',
  autoSwitchFailed: 'Otomatik geçiş başarısız',

  // TUN and system proxy
  tunUnsupported: 'TUN modu bu işletim sisteminde desteklenmiyor.',
  tunNeedsAdmin:
    'TUN modu yönetici hakları gerektirir. UAC istemini onaylayın veya UltimaVLESS’i yönetici olarak çalıştırın.',
  tunNeedsPolkit:
    'TUN modu yükseltilmiş haklar gerektirir. UltimaVLESS’in bağlanırken bu hakları isteyebilmesi için bir PolicyKit aracısı (pkexec) kurun veya UltimaVLESS’i root olarak çalıştırın.',
  tunNeedsRoot:
    'Bu işletim sisteminde TUN modu root hakları gerektirir. Uygulamayı yükseltilmiş haklarla çalıştırın.',
  tunAuthDeclined:
    'TUN modu yükseltilmiş haklar gerektirir, ancak yetki isteği reddedildi veya kapatıldı.',

  // Android VpnService
  vpnPermissionDenied: 'VPN izni yok: bağlanırken Android isteğini onaylayın',
  vpnRevoked: 'VPN kapatıldı: tüneli başka bir VPN istemcisi aldı',
  vpnServiceStopped: 'VPN hizmeti sistem tarafından durduruldu',
  localProxyNotOpened: 'Xray, 127.0.0.1:$<port> üzerinde yerel proxy açmadı',
  tunRootPrepareFailed:
    'TUN modu, Xray’i root olarak çalıştırmaya hazırlayamadı: ',
  tunRootCopyFailed: 'TUN modu, Xray’in root’a ait bir kopyasını oluşturamadı',
  tunRootCopyMismatch:
    'TUN modu Xray’i çalıştırmadı: kopya, UltimaVLESS ile gelenle eşleşmiyor',
  tunRootRunFailed: 'TUN modu Xray’i root olarak çalıştıramadı',
  tunAdapterNoGateway:
    'TUN için seçilen «$<name>» ağ bağdaştırıcısının IPv4 varsayılan ağ geçidi yok (bağlantısı kesik veya internete çıkmıyor). «Ayarlar → Ağ» bölümünden başka bir bağdaştırıcı seçin veya «Otomatik» yapın.',
  noDefaultRoute: 'Varsayılan rota bulunamadı. Ağ bağlantınızı kontrol edin.',
  proxyResolveFailed: 'Sunucunun IP adresi alınamadı: ',
  modeChangeWhileConnecting:
    'Ağ modunu değiştirmeden önce bağlantının tamamlanmasını bekleyin.',
  linuxProxyNeedsGnome:
    'Linux’ta sistem proxy’si için GNOME uyumlu bir masaüstü ve gsettings aracı gerekir.',
  linuxProxyEnableFailed: 'Sistem proxy’si gsettings ile açılamadı: ',
  linuxProxyDisableFailed: 'Sistem proxy’si gsettings ile kapatılamadı: ',
  macNoNetworkServices:
    'Sistem proxy’sini ayarlamak için macOS ağ hizmeti bulunamadı.',

  // Server profile vs bundled Xray
  trojanNeedsTls:
    'Xray $<version>, TLS veya REALITY olmadan Trojan ile genel bir adrese bağlanmaz. security=tls veya security=reality belirtin.',
  vlessNeedsTls:
    'Xray $<version>, TLS, REALITY veya VLESS Encryption olmadan VLESS ile genel bir adrese bağlanmaz. security=tls veya security=reality belirtin.',
  hysteriaNeedsTls:
    'Xray $<version> sürümünde Hysteria yalnızca TLS ile çalışır (streamSettings.security=tls).',
  allowInsecureRemoved:
    'Xray $<version> sürümünde «allowInsecure» parametresi kaldırıldı; yerine pinnedPeerCertSha256 (pcs) ve/veya verifyPeerCertByName (vcn) kullanın.',
  ssMethodRemoved:
    '«$<method>» Shadowsocks yöntemi Xray $<version> sürümünde kaldırıldı; bir AEAD şifresi kullanın (örneğin aes-128-gcm veya chacha20-poly1305).',
  ssMethodRequired: 'Shadowsocks şifreleme yöntemi belirtilmemiş.',
  httpTransportUnsupported:
    'HTTP aktarımı Xray $<version> sürümünde desteklenmiyor; XHTTP kullanın.',
  quicTransportUnsupported:
    'QUIC aktarımı Xray $<version> sürümünde desteklenmiyor; XHTTP/H3 kullanın.',
  realityTransport:
    'REALITY yalnızca RAW/TCP, XHTTP ve gRPC aktarımlarıyla çalışır.',
  hysteriaNeedsAuth: 'Hysteria için parola (hysteriaAuth) gerekir.',
  wgNeedsKey: 'WireGuard için özel anahtar (wgSecretKey) gerekir.',
  wgNeedsAddress: 'WireGuard için arayüz adresi (wgAddress) gerekir.',
  wgNeedsPeer: 'WireGuard için en az bir eş (peer) gerekir.',
  rawConfigNeedsProxy:
    'JSON yapılandırmasında tünel protokollü bir «proxy» outbound’u gerekir.',

  // Subscriptions
  subscriptionNoLinks: 'Abonelikte geçerli hiçbir sunucu bağlantısı yok',
  noValidLinks: 'Geçerli hiçbir sunucu bağlantısı bulunamadı',
  manualNoValidLinks: 'Elle eklenen bağlantıların hiçbiri geçerli değil',
  subscriptionHttpError:
    'Abonelik sunucusu HTTP $<status> hatasıyla yanıt verdi',
  subscriptionTimeout: 'Abonelik sunucusu $<seconds> sn içinde yanıt vermedi',
  subscriptionUnreachable: 'Abonelik sunucusuna ulaşılamadı ($<code>)',
  subscriptionTooLarge: 'Abonelik yanıtı çok büyük',
  subscriptionEmpty: 'Abonelik boş bir yanıt döndürdü',
  subscriptionBadBase64: 'Abonelik bozuk veri döndürdü (Base64 hatası)',
  subscriptionHtmlPage:
    'Abonelik adresi, sunucu bağlantısı içermeyen bir HTML sayfası açtı',
  subscriptionPrivateIp: 'Abonelik adresi yerel bir IP’yi gösteriyor',
  subscriptionHostNotAllowed: 'Bu abonelik adresine izin verilmiyor',
  subscriptionNoAddress: 'Abonelik sunucusunun IP adresi bulunamadı',
  subscriptionDnsFailed:
    'Abonelik sunucusunun adresi doğrulanamadı (DNS sorgusu başarısız oldu veya zaman aşımına uğradı)',
  subscriptionTooManyRedirects:
    'Abonelik yüklenirken çok fazla yönlendirme oldu (en fazla $<max>)',
  subscriptionRedirectNoLocation:
    'Abonelik sunucusu adressiz bir yönlendirme döndürdü (HTTP $<status>)',
  subscriptionHttpsOnly: 'Yalnızca HTTPS abonelik adreslerine izin verilir',
  happEncryptedLink:
    'Bu şifreli bir Happ bağlantısı (happ://crypt…): yalnızca Happ uygulaması açabilir. Sağlayıcınızdan https:// ile başlayan normal bir abonelik bağlantısı isteyin',
  subscriptionInvalidUrl: 'Abonelik adresi geçersiz',
  subscriptionNameRequired: 'Abonelik adını girin',
  subscriptionUrlRequired: 'Abonelik adresini girin',
  subscriptionNameTooLong: 'Abonelik adı çok uzun (en fazla $<max> karakter)',
  subscriptionUrlTooLong: 'Abonelik adresi çok uzun (en fazla $<max> karakter)',
  manualLinksTooLarge:
    'Bağlantılarda çok fazla metin var (en fazla $<max> karakter)',
};
