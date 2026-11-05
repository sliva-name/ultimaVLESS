import type { ErrorPhrases } from './patterns';

export const ru: ErrorPhrases = {
  // Xray process
  configGenerationFailed: 'Ошибка в конфигурации сервера: ',
  xrayBinaryNotFound: 'Не найден исполняемый файл Xray: ',
  portInUse:
    'Порт $<port> на 127.0.0.1 занят другой программой (другим VPN или прокси-клиентом?). Закройте её и подключитесь снова.',
  portUnavailable: 'Порт $<port> на 127.0.0.1 недоступен ($<code>).',
  xrayExitedAtStartup:
    'Xray завершился при запуске (код $<code>, сигнал $<signal>)',
  xrayExitedUnexpectedly:
    'Xray неожиданно завершился (код $<code>, сигнал $<signal>)',
  xrayExitedBeforeListeners:
    'Xray завершился раньше, чем открылись локальные порты прокси',
  listenersUnreachable: 'Локальные порты прокси недоступны',
  xrayHealthFailed: 'Xray сообщил о сбое',

  // Connection and health checks
  connectionError: 'Ошибка подключения: ',
  connectionFailed: 'Не удалось подключиться',
  disconnected: 'Отключено',
  connectedTo: 'Подключено к $<name>',
  switchingFromTo: 'Переключение с $<from> на $<to>',
  switchingTo: 'Переключение на $<name>',
  remoteCheckFailed:
    'Проверка доступа в интернет через туннель не прошла после нескольких попыток (туннель медленный или заблокирован)',
  hostOffline: 'Нет доступа в интернет и без VPN; автопереключение отложено',
  postSwitchCheckFailed: 'После смены сервера трафик не проходит',
  serverNotFound: 'Выбранный сервер не найден в списке',
  autoSwitchOffline: 'Автопереключение прервано: нет доступа в интернет',
  autoSwitchTimeUp: 'Автопереключение остановлено: истекло отведённое время',
  autoSwitchNoServers:
    'Автопереключение не удалось: рабочих серверов не найдено',
  autoSwitchFailed: 'Автопереключение не удалось',

  // TUN and system proxy
  tunUnsupported: 'Режим TUN не поддерживается в этой операционной системе.',
  tunNeedsAdmin:
    'Для режима TUN нужны права администратора. Подтвердите запрос UAC или запустите UltimaVLESS от имени администратора.',
  tunNeedsPolkit:
    'Для режима TUN нужны повышенные права. Установите агент PolicyKit (pkexec), чтобы UltimaVLESS запросил их при подключении, или запустите UltimaVLESS от root.',
  tunNeedsRoot:
    'В этой операционной системе для режима TUN нужны права root. Запустите приложение с повышенными правами.',
  tunAuthDeclined:
    'Для режима TUN нужны повышенные права, но запрос был отклонён или закрыт.',

  // Android VpnService
  vpnPermissionDenied:
    'Нет разрешения на VPN: подтвердите запрос Android при подключении',
  vpnRevoked: 'VPN отключён: туннель занял другой VPN-клиент',
  vpnServiceStopped: 'Служба VPN остановлена системой',
  localProxyNotOpened: 'Xray не открыл локальный прокси на 127.0.0.1:$<port>',
  tunRootPrepareFailed:
    'Режиму TUN не удалось подготовить Xray для запуска от root: ',
  tunRootCopyFailed:
    'Режиму TUN не удалось сделать копию Xray, принадлежащую root',
  tunRootCopyMismatch:
    'Режим TUN не запустил Xray: копия не совпадает с поставляемой с UltimaVLESS',
  tunRootRunFailed: 'Режиму TUN не удалось запустить Xray от root',
  tunAdapterNoGateway:
    'У адаптера «$<name>», выбранного для TUN, нет IPv4-шлюза по умолчанию (он отключён или не выходит в интернет). Выберите другой адаптер в «Настройки → Сеть» или «Автоматически».',
  noDefaultRoute:
    'Не найден маршрут по умолчанию. Проверьте подключение к сети.',
  proxyResolveFailed: 'Не удалось получить IP-адрес сервера: ',
  modeChangeWhileConnecting:
    'Дождитесь окончания подключения, прежде чем менять режим сети.',
  linuxProxyNeedsGnome:
    'Для системного прокси в Linux нужно окружение, совместимое с GNOME, и утилита gsettings.',
  linuxProxyEnableFailed:
    'Не удалось включить системный прокси через gsettings: ',
  linuxProxyDisableFailed:
    'Не удалось выключить системный прокси через gsettings: ',
  macNoNetworkServices:
    'Не найдены сетевые службы macOS для настройки системного прокси.',

  // Server profile vs bundled Xray
  trojanNeedsTls:
    'Xray $<version> не подключается к публичному адресу по Trojan без TLS или REALITY. Укажите security=tls или security=reality.',
  vlessNeedsTls:
    'Xray $<version> не подключается к публичному адресу по VLESS без TLS, REALITY или VLESS Encryption. Укажите security=tls или security=reality.',
  hysteriaNeedsTls:
    'В Xray $<version> Hysteria работает только с TLS (streamSettings.security=tls).',
  allowInsecureRemoved:
    'В Xray $<version> параметр «allowInsecure» удалён; вместо него укажите pinnedPeerCertSha256 (pcs) и/или verifyPeerCertByName (vcn).',
  ssMethodRemoved:
    'Метод Shadowsocks «$<method>» удалён в Xray $<version>; используйте AEAD-шифр (например, aes-128-gcm или chacha20-poly1305).',
  ssMethodRequired: 'Не указан метод шифрования Shadowsocks.',
  httpTransportUnsupported:
    'Транспорт HTTP не поддерживается в Xray $<version>; используйте XHTTP.',
  quicTransportUnsupported:
    'Транспорт QUIC не поддерживается в Xray $<version>; используйте XHTTP/H3.',
  realityTransport:
    'REALITY работает только с транспортами RAW/TCP, XHTTP и gRPC.',
  hysteriaNeedsAuth: 'Для Hysteria нужен пароль (hysteriaAuth).',
  wgNeedsKey: 'Для WireGuard нужен приватный ключ (wgSecretKey).',
  wgNeedsAddress: 'Для WireGuard нужен адрес интерфейса (wgAddress).',
  wgNeedsPeer: 'Для WireGuard нужен хотя бы один пир (peer).',
  rawConfigNeedsProxy:
    'В JSON-конфиге нужен outbound «proxy» с туннельным протоколом.',

  // Subscriptions
  subscriptionNoLinks: 'В подписке нет ни одной подходящей ссылки на сервер',
  noValidLinks: 'Не найдено ни одной подходящей ссылки на сервер',
  manualNoValidLinks:
    'Среди ссылок, добавленных вручную, нет ни одной подходящей',
  subscriptionHttpError: 'Сервер подписки ответил ошибкой HTTP $<status>',
  subscriptionTimeout: 'Сервер подписки не ответил за $<seconds> с',
  subscriptionUnreachable: 'Не удалось связаться с сервером подписки ($<code>)',
  subscriptionTooLarge: 'Ответ подписки слишком большой',
  subscriptionEmpty: 'Подписка вернула пустой ответ',
  subscriptionBadBase64: 'Подписка вернула повреждённые данные (ошибка Base64)',
  subscriptionHtmlPage:
    'По адресу подписки открылась HTML-страница без ссылок на серверы',
  subscriptionPrivateIp: 'Адрес подписки указывает на локальный IP',
  subscriptionHostNotAllowed: 'Этот адрес подписки не разрешён',
  subscriptionNoAddress: 'Не удалось найти IP-адрес сервера подписки',
  subscriptionDnsFailed:
    'Не удалось проверить адрес сервера подписки (DNS-запрос не прошёл или не уложился во время)',
  subscriptionTooManyRedirects:
    'Слишком много перенаправлений при загрузке подписки (максимум $<max>)',
  subscriptionRedirectNoLocation:
    'Сервер подписки вернул перенаправление без адреса (HTTP $<status>)',
  subscriptionHttpsOnly: 'Разрешены только адреса подписок с HTTPS',
  happEncryptedLink:
    'Это зашифрованная ссылка Happ (happ://crypt…): открыть её может только приложение Happ. Попросите у провайдера обычную ссылку на подписку, начинающуюся с https://',
  subscriptionInvalidUrl: 'Некорректный адрес подписки',
  subscriptionNameRequired: 'Укажите название подписки',
  subscriptionUrlRequired: 'Укажите адрес подписки',
  subscriptionNameTooLong:
    'Слишком длинное название подписки (максимум $<max> символов)',
  subscriptionUrlTooLong:
    'Слишком длинный адрес подписки (максимум $<max> символов)',
  manualLinksTooLarge:
    'Слишком много текста в ссылках (максимум $<max> символов)',
};
