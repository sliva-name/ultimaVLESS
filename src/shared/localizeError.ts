/**
 * Errors from the main process are written in English, the language of the
 * logs. This translates the ones users see in the window, the tray and
 * notifications. Each entry replaces a phrase wherever it occurs, so wrapped
 * messages ("<subscription>: …", "Config generation failed: …") are translated
 * piece by piece, and text that comes from Xray itself is left as it is.
 */
type PhraseTable = ReadonlyArray<readonly [RegExp, string]>;

const VERSION = String.raw`(?<version>v?\d+(?:\.\d+)*)`;

const RU_PHRASES: PhraseTable = [
  // Xray process
  [/Config generation failed: /g, 'Ошибка в конфигурации сервера: '],
  [/Xray binary not found at: /g, 'Не найден исполняемый файл Xray: '],
  [
    /Port (?<port>\d+) on 127\.0\.0\.1 is already used by another program \(another VPN or proxy client\?\)\. Close it and connect again\./g,
    'Порт $<port> на 127.0.0.1 занят другой программой (другим VPN или прокси-клиентом?). Закройте её и подключитесь снова.',
  ],
  [
    /Port (?<port>\d+) on 127\.0\.0\.1 cannot be used \((?<code>[^)]+)\)\./g,
    'Порт $<port> на 127.0.0.1 недоступен ($<code>).',
  ],
  [
    /Xray exited during startup \(code=(?<code>[^,]+), signal=(?<signal>[^)]+)\)/g,
    'Xray завершился при запуске (код $<code>, сигнал $<signal>)',
  ],
  [
    /Xray exited unexpectedly \(code=(?<code>[^,]+), signal=(?<signal>[^)]+)\)/g,
    'Xray неожиданно завершился (код $<code>, сигнал $<signal>)',
  ],
  [
    /Xray process exited before local proxy listeners became ready/g,
    'Xray завершился раньше, чем открылись локальные порты прокси',
  ],
  [
    /Local proxy listeners are unreachable/g,
    'Локальные порты прокси недоступны',
  ],
  [/Xray reported failed health status/g, 'Xray сообщил о сбое'],

  // Connection and health checks
  [/Connection error: /g, 'Ошибка подключения: '],
  [/^Connection failed$/g, 'Не удалось подключиться'],
  [/^Disconnected$/g, 'Отключено'],
  [/^Connected to (?<name>.+)$/g, 'Подключено к $<name>'],
  [
    /^Switching from (?<from>.+) to (?<to>.+)$/g,
    'Переключение с $<from> на $<to>',
  ],
  [/^Switching to (?<name>.+)$/g, 'Переключение на $<name>'],
  [
    /Remote endpoint check via proxy failed after retries \(tunnel may be slow or blocked\)/g,
    'Проверка доступа в интернет через туннель не прошла после нескольких попыток (туннель медленный или заблокирован)',
  ],
  [
    /Host internet connectivity is unavailable; auto-switch is deferred/g,
    'Нет доступа в интернет и без VPN; автопереключение отложено',
  ],
  [
    /Post-switch traffic validation failed/g,
    'После смены сервера трафик не проходит',
  ],
  [
    /Selected server was not found in local configuration/g,
    'Выбранный сервер не найден в списке',
  ],
  [
    /Auto-switch aborted: host internet unavailable/g,
    'Автопереключение прервано: нет доступа в интернет',
  ],
  [
    /Auto-switch stopped: time budget exhausted/g,
    'Автопереключение остановлено: истекло отведённое время',
  ],
  [
    /Auto-switch failed: no working servers found/g,
    'Автопереключение не удалось: рабочих серверов не найдено',
  ],
  [/^Auto-switch failed$/g, 'Автопереключение не удалось'],

  // TUN and system proxy
  [
    /TUN mode is not supported on this operating system\./g,
    'Режим TUN не поддерживается в этой операционной системе.',
  ],
  [
    /TUN mode requires Administrator rights\. Please approve UAC prompt or run UltimaVLESS as Administrator\./g,
    'Для режима TUN нужны права администратора. Подтвердите запрос UAC или запустите UltimaVLESS от имени администратора.',
  ],
  [
    /TUN mode needs elevated privileges\. Install a PolicyKit agent \(pkexec\) so UltimaVLESS can request them at connect time, or run UltimaVLESS as root\./g,
    'Для режима TUN нужны повышенные права. Установите агент PolicyKit (pkexec), чтобы UltimaVLESS запросил их при подключении, или запустите UltimaVLESS от root.',
  ],
  [
    /TUN mode requires root privileges on this operating system\. Please run the app with elevated permissions\./g,
    'В этой операционной системе для режима TUN нужны права root. Запустите приложение с повышенными правами.',
  ],
  [
    /TUN mode requires elevated privileges, but the authorization request was declined or dismissed\./g,
    'Для режима TUN нужны повышенные права, но запрос был отклонён или закрыт.',
  ],
  [
    /Network adapter "(?<name>[^"]*)" selected for TUN has no IPv4 default gateway \(disconnected, or not an internet connection\)\. Choose another adapter in Settings → Network or set it to Automatic\./g,
    'У адаптера «$<name>», выбранного для TUN, нет IPv4-шлюза по умолчанию (он отключён или не выходит в интернет). Выберите другой адаптер в «Настройки → Сеть» или «Автоматически».',
  ],
  [
    /Could not get default route\. Check network connection\./g,
    'Не найден маршрут по умолчанию. Проверьте подключение к сети.',
  ],
  [
    /Could not resolve proxy server address: /g,
    'Не удалось получить IP-адрес сервера: ',
  ],
  [
    /Disconnect before changing connection mode\./g,
    'Отключитесь перед изменением режима сети.',
  ],
  [
    /Linux system proxy control currently requires a GNOME-compatible desktop with gsettings available\./g,
    'Для системного прокси в Linux нужно окружение, совместимое с GNOME, и утилита gsettings.',
  ],
  [
    /Failed to enable Linux system proxy via gsettings: /g,
    'Не удалось включить системный прокси через gsettings: ',
  ],
  [
    /Failed to disable Linux system proxy via gsettings: /g,
    'Не удалось выключить системный прокси через gsettings: ',
  ],
  [
    /No macOS network services found for system proxy configuration\./g,
    'Не найдены сетевые службы macOS для настройки системного прокси.',
  ],

  // Server profile vs bundled Xray
  [
    new RegExp(
      String.raw`Trojan requires TLS \(or REALITY\) for public server addresses in Xray ${VERSION}\. Set security=tls or security=reality\.`,
      'g',
    ),
    'Xray $<version> не подключается к публичному адресу по Trojan без TLS или REALITY. Укажите security=tls или security=reality.',
  ],
  [
    new RegExp(
      String.raw`VLESS requires TLS/REALITY \(or VLESS Encryption\) for public server addresses in Xray ${VERSION}\. Set security=tls or security=reality\.`,
      'g',
    ),
    'Xray $<version> не подключается к публичному адресу по VLESS без TLS, REALITY или VLESS Encryption. Укажите security=tls или security=reality.',
  ],
  [
    new RegExp(
      String.raw`Hysteria requires streamSettings\.security=tls in Xray ${VERSION}\.`,
      'g',
    ),
    'В Xray $<version> Hysteria работает только с TLS (streamSettings.security=tls).',
  ],
  [
    new RegExp(
      String.raw`"allowInsecure" was removed in bundled Xray ${VERSION}; use pinnedPeerCertSha256 \(pcs\) and/or verifyPeerCertByName \(vcn\) instead\.`,
      'g',
    ),
    'В Xray $<version> параметр «allowInsecure» удалён; вместо него укажите pinnedPeerCertSha256 (pcs) и/или verifyPeerCertByName (vcn).',
  ],
  [
    new RegExp(
      String.raw`Shadowsocks method "(?<method>[^"]*)" was removed in Xray ${VERSION}; use an AEAD cipher \(e\.g\. aes-128-gcm, chacha20-poly1305\)\.`,
      'g',
    ),
    'Метод Shadowsocks «$<method>» удалён в Xray $<version>; используйте AEAD-шифр (например, aes-128-gcm или chacha20-poly1305).',
  ],
  [
    /Shadowsocks method is required\./g,
    'Не указан метод шифрования Shadowsocks.',
  ],
  [
    new RegExp(
      String.raw`HTTP transport is not supported by bundled Xray ${VERSION}; use XHTTP instead\.`,
      'g',
    ),
    'Транспорт HTTP не поддерживается в Xray $<version>; используйте XHTTP.',
  ],
  [
    new RegExp(
      String.raw`QUIC transport is not supported by bundled Xray ${VERSION}; use XHTTP/H3 instead\.`,
      'g',
    ),
    'Транспорт QUIC не поддерживается в Xray $<version>; используйте XHTTP/H3.',
  ],
  [
    /REALITY transport requires RAW\/TCP, XHTTP, or gRPC\./g,
    'REALITY работает только с транспортами RAW/TCP, XHTTP и gRPC.',
  ],
  [
    /Hysteria outbound requires hysteriaAuth \(or password\)\./g,
    'Для Hysteria нужен пароль (hysteriaAuth).',
  ],
  [
    /WireGuard outbound requires wgSecretKey\./g,
    'Для WireGuard нужен приватный ключ (wgSecretKey).',
  ],
  [
    /WireGuard outbound requires wgAddress\./g,
    'Для WireGuard нужен адрес интерфейса (wgAddress).',
  ],
  [
    /WireGuard outbound requires at least one peer\./g,
    'Для WireGuard нужен хотя бы один пир (peer).',
  ],
  [
    /Raw config must include an outbound tagged "proxy" with a tunnel protocol\./g,
    'В JSON-конфиге нужен outbound «proxy» с туннельным протоколом.',
  ],

  // Subscriptions
  [
    /No valid configuration links were found in the subscription/g,
    'В подписке нет ни одной подходящей ссылки на сервер',
  ],
  [
    /No valid configuration links were found/g,
    'Не найдено ни одной подходящей ссылки на сервер',
  ],
  [
    /No valid configs found in manual links/g,
    'Среди ссылок, добавленных вручную, нет ни одной подходящей',
  ],
  [
    /Subscription request failed: HTTP (?<status>\d+)/g,
    'Сервер подписки ответил ошибкой HTTP $<status>',
  ],
  [
    /Subscription server did not respond within (?<seconds>\d+)s/g,
    'Сервер подписки не ответил за $<seconds> с',
  ],
  [
    /Could not reach the subscription server \((?<code>[^)]+)\)/g,
    'Не удалось связаться с сервером подписки ($<code>)',
  ],
  [/Subscription response is too large/g, 'Ответ подписки слишком большой'],
  [/Empty response from subscription URL/g, 'Подписка вернула пустой ответ'],
  [
    /Invalid Base64 response/g,
    'Подписка вернула повреждённые данные (ошибка Base64)',
  ],
  [
    /Subscription URL returned an HTML page without proxy links/g,
    'По адресу подписки открылась HTML-страница без ссылок на серверы',
  ],
  [
    /Subscription URL resolves to a private IP/g,
    'Адрес подписки указывает на локальный IP',
  ],
  [/Subscription URL host is not allowed/g, 'Этот адрес подписки не разрешён'],
  [
    /Subscription URL did not resolve to any address/g,
    'Не удалось найти IP-адрес сервера подписки',
  ],
  [
    /Could not verify the subscription host address \(DNS lookup failed or timed out\)/g,
    'Не удалось проверить адрес сервера подписки (DNS-запрос не прошёл или не уложился во время)',
  ],
  [
    /Too many redirects while fetching subscription \(max (?<max>\d+)\)/g,
    'Слишком много перенаправлений при загрузке подписки (максимум $<max>)',
  ],
  [
    /Redirect response missing Location header: HTTP (?<status>\d+)/g,
    'Сервер подписки вернул перенаправление без адреса (HTTP $<status>)',
  ],
  [
    /Only HTTPS subscription URLs are allowed/g,
    'Разрешены только адреса подписок с HTTPS',
  ],
  [/Invalid subscription URL/g, 'Некорректный адрес подписки'],
  [/Subscription name is required/g, 'Укажите название подписки'],
  [/Subscription URL is required/g, 'Укажите адрес подписки'],
  [
    /Subscription name is too long \(max (?<max>\d+) characters\)/g,
    'Слишком длинное название подписки (максимум $<max> символов)',
  ],
  [
    /Subscription URL is too long \(max (?<max>\d+) characters\)/g,
    'Слишком длинный адрес подписки (максимум $<max> символов)',
  ],
  [
    /Manual links payload is too large \(max (?<max>\d+) characters\)/g,
    'Слишком много текста в ссылках (максимум $<max> символов)',
  ],
];

/** Electron prefixes errors thrown by an `ipcMain.handle` handler. */
const IPC_INVOKE_PREFIX =
  /^Error invoking remote method '[^']*': (?:\w*Error: )?/;

export function localizeError(message: string, language: string): string {
  const text = message.replace(IPC_INVOKE_PREFIX, '');
  if (language !== 'ru') return text;
  return RU_PHRASES.reduce(
    (result, [pattern, replacement]) => result.replace(pattern, replacement),
    text,
  );
}
