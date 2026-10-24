# Аудит UltimaVLESS 7.19.0 против Xray-core v26.10.21

Дата: 2026-10-24. Ветка: `claude/quirky-dirac-iec5sg`. Серьёзные баги исправлены в этой же ветке — см. [Статус исправлений](#статус-исправлений).

## Как проверялось

| Что                | Как                                                                                                                                                                                                                                                                                                                     |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Базовая линия      | `typecheck`, `lint`, 507 тестов — всё зелёное                                                                                                                                                                                                                                                                           |
| Генератор конфигов | 42 share-ссылки × 5 контекстов (proxy, TUN auto-route, TUN PowerShell, режим «сайты» + блокировки + mux + debug, режим «приложения» + IPIfNonMatch). Конфиг строится кодом клиента (`parseDirectLinksFromText` → `XrayConfigCompiler.compile`) и проверяется `xray run -test` бинарником v26.10.21                      |
| Живой трафик       | Локальный xray-сервер с 20 входами (VLESS REALITY/Vision, TLS+WS/XHTTP/H3/gRPC/HTTPUpgrade/Vision, Trojan TLS/REALITY/XHTTP, SS-2022, SS+WS+TLS, Hysteria2 (+salamander), VLESS Encryption, VMess, TCP+HTTP-заголовок). Целевой HTTP-сервер на «публичном» IP; факт прохода через сервер проверяется по его access-логу |
| JSON-подписки      | 12 конфигов в стиле Remnawave/Marzban/v2rayN (fragment, балансировщик, `proxySettings`, свои routing/dns/inbounds)                                                                                                                                                                                                      |
| Linux TUN          | Сгенерированный TUN-конфиг в отдельном network namespace, фейковые DNS «роутера» и «удалённый»                                                                                                                                                                                                                          |
| Runtime            | Настоящие `XrayService`, `ConnectionMonitorService`, `ConnectionRuntime`, `XrayStatsClient`, `RealDelayService`, `PingService`                                                                                                                                                                                          |
| Сверка с xray      | Исходники Xray-core на теге v26.10.21 (`infra/conf`, `proxy/tun`, `proxy/dns`, `transport/internet/tls`, `app/commander`)                                                                                                                                                                                               |

Итог: `xray -test` принимает 175 из 210 конфигов (все отказы ниже объяснены). Живой трафик проходит у 16 из 20 типов ссылок и у 11 из 12 JSON-конфигов.

## Статус исправлений

Перед исправлением каждый пункт заново воспроизведён на текущем коде и сверен с исходниками Xray-core (v26.10.21 — последний тег, совпадает с HEAD `main`) и документацией Project X (`XTLS/Xray-docs-next`, коммит от 23.10.2026). После исправлений живой трафик проходит у **20 из 20** типов ссылок; `npm run verify:ci` — 544 теста зелёные.

| №          | Статус                  | Коммит               | Чем подтверждено после исправления                                                                                                                                                                                                                                                                                                                                          |
| ---------- | ----------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1          | исправлено              | `ed0a02f`            | Живой трафик через «привязку к IP»: 8/8 PASS (было 2 FAIL). Docs: «When left empty, the value in `address` is used automatically if that value is a domain name»                                                                                                                                                                                                            |
| 2, 4, 5    | исправлено              | `6d0d6e9`            | Trojan+REALITY, Trojan+XHTTP, XHTTP/H3 (`alpn=h3`), TCP+HTTP-заголовок — PASS. Исходник: XHTTP выбирает HTTP/3 только при `alpn: ["h3"]` (`splithttp/dialer.go`); `alpn` — параметр стандарта ссылок (XTLS/Xray-core#716)                                                                                                                                                   |
| 3          | **не баг**, не менялось | —                    | Документация Trojan: «In public environments, Mux is also required; otherwise … it becomes TiT». Принудительный Mux — намеренное следование рекомендации; цена — несовместимость с серверами не на xray (trojan-gfw/trojan-go)                                                                                                                                              |
| 3а (новое) | исправлено              | `6d0d6e9`            | Mux.Cool поверх XHTTP: входящий XHTTP в xray пропускает через Mux только UDP (`app/proxyman/inbound/inbound.go:177`), поэтому TCP с Mux не работал — и у Trojan+XHTTP (Mux принудительный), и у VLESS+XHTTP при включённом в настройках Mux. Теперь Mux для XHTTP выключен, как для gRPC/Hysteria                                                                           |
| 6          | исправлено              | `7d88949`            | TUN в netns на ядре без IPv6 запускается и пропускает трафик через сервер                                                                                                                                                                                                                                                                                                   |
| 7          | исправлено              | `6d0d6e9`, `7d88949` | Адрес хранится без скобок (ID серверов прежние); пинг и план TUN для `[2001:db8::10]` работают, в т. ч. для уже сохранённых серверов                                                                                                                                                                                                                                        |
| 8          | исправлено              | `b64b57f`            | Здоровая проба + строка `proxy/freedom … failed to dial` → 0 health-failure, статус healthy                                                                                                                                                                                                                                                                                 |
| 9          | исправлено              | `9894ff7`            | Настоящий `XrayService`, 3 переключения: порты всё время 10808/10809, системный прокси включён один раз. Окно недоступности при смене процесса 20–330 мс                                                                                                                                                                                                                    |
| 10         | исправлено              | `bd23dd6`            | Занятый порт → понятная ошибка до запуска xray вместо ложного «подключено»                                                                                                                                                                                                                                                                                                  |
| 11         | исправлено              | `bd23dd6`            | `fp=none` → «Xray exited during startup (code=23): Failed to build TLS config. > unknown "fingerprint": none»                                                                                                                                                                                                                                                               |
| 12         | исправлено              | `11ea94e`            | `fp=none` трактуется как «не задано» (документация: по умолчанию `chrome`, `none` — не значение xray). Ссылка с `fp=none` проходит живой трафик                                                                                                                                                                                                                             |
| 13         | исправлено              | `11ea94e`            | `insecure=1` рядом с `pcs`/`pinSHA256`/`vcn` больше не отвергается: совпавший пин сам принимает сертификат (`transport/internet/tls/config.go`, `foundLeaf`). Hysteria2 и Trojan с `insecure=1` + пин — PASS; `insecure=1` без замены по-прежнему ошибка                                                                                                                    |
| 14         | исправлено              | `ec36e57`            | Прокси-outbound под другим тегом переименовывается в `proxy` вместе со ссылками (routing, `dialerProxy`, `fallbackTag`). JSON-подписки живьём — 12/12. Заодно в списке теперь адрес того outbound, через который идёт подключение                                                                                                                                           |
| 15         | **не исправлено**       | —                    | Нужен `autoSystemDnsToGateway`, а он работает только с systemd-resolved, без него xray не запускает TUN; ещё нужно заранее резолвить домен сервера, иначе получается петля resolved → TUN → DNS → proxy. Проверить в контейнере без systemd нельзя                                                                                                                          |
| 16         | исправлено              | `00ee578`            | Документация DNS-outbound: без правила не-A/AAAA получают пустой ответ, `hijack` умеет только A/AAAA. Теперь они идут на удалённый резолвер через `proxy` (`sockopt.dialerProxy`). В TUN запросы типов 16/33/65 доходят до резолвера через сервер                                                                                                                           |
| 17         | исправлено              | `ab191dd`            | На Linux маршруты TUN — `0.0.0.0/1` + `128.0.0.0/1`: при дефолтном маршруте с метрикой 0 трафик теперь идёт через сервер (в netns), xray по-прежнему находит физический интерфейс по `/0`                                                                                                                                                                                   |
| 18         | исправлено              | `5977abd`            | Порт по умолчанию 443, как в схеме ссылок Trojan-Go; `trojan://…@host` без порта проходит живой трафик                                                                                                                                                                                                                                                                      |
| 19         | исправлено              | `5977abd`            | `v2ray-plugin`/`xray-plugin` в режиме websocket (режим плагина по умолчанию) становится WS-транспортом; прочие плагины (`obfs-local`, `mode=quic` и т. п.) — сервер пропускается с предупреждением в логе. SS + v2ray-plugin без `mode` — PASS                                                                                                                              |
| 20         | исправлено              | `5977abd`            | `type=h2` → понятная ошибка «HTTP transport is not supported … use XHTTP» (xray удалил этот транспорт); неизвестный `type` — ссылка пропускается с предупреждением в логе; регистр `type` не важен                                                                                                                                                                          |
| 21         | исправлено              | `8856555`            | Подсети, суффиксы и регулярка для имён без точки взяты из `common/geodata/consts.go`. Сверка с `xray run -test` на 76 адресах × VLESS/Trojan: 0 расхождений (было 22 из 152). Заодно Hysteria без TLS отклоняется и для частных адресов: xray с таким конфигом стартует, но каждое соединение падает с `tls config is nil`                                                  |
| 22         | исправлено              | `8c2f4ca`            | Пофразный перевод в `src/shared/localizeError.ts` для окна, трея и уведомлений; текст самого xray и логи не меняются. Тест бросает настоящие ошибки генератора и проверяет, что английских фраз не осталось (сразу нашёл расхождение с форматом версии `v26.10.21`). Тайм-аут и сетевые ошибки подписки теперь называют причину (`ENOTFOUND` и т. п.) вместо «fetch failed» |

После всех правок `xray -test` принимает 185 из 206 конфигов матрицы (было 175). Остальные 21 отклоняет уже сам клиент с понятной причиной, и все отказы намеренные: `allowInsecure` без замены, VLESS без шифрования на публичный адрес, удалённый в xray транспорт h2, SS-плагин `obfs-local`. Конфигов, которые клиент собрал бы, а xray отверг, не осталось. `npm run verify:ci` — 575 тестов зелёные.

## Подтверждённые баги

Каждый воспроизведён тестом или запуском xray. Отсортированы по влиянию.

### Высокая важность

**1. Windows TUN: ссылки без `sni=` перестают работать.**
`src/main/domain/connection/NetworkModeRuntime.ts:65` → `src/main/domain/connection/bindProxyEndpoint.ts:15`.
В TUN на Windows адрес сервера подменяется на IP, а `serverName`/WS `host` остаются пустыми. xray подставляет SNI из адреса назначения (`transport/internet/tls/config.go:495`), то есть уже из IP.
Воспроизведение: сервер с сертификатом на `cdn.audit-test.org`, ссылки `vless://…@cdn.audit-test.org:4451?type=ws&security=tls&path=%2Fws` и `trojan://pa55word@cdn.audit-test.org:4452`. В режиме прокси обе работают. После `bindProxyEndpointToIp` (так делает Windows TUN) обе падают: `x509: cannot validate certificate for <IP> because it doesn't contain any IP SANs`. С явным `sni=` работают оба варианта. Для WS/HTTPUpgrade/XHTTP за CDN заголовок `Host` тоже становится IP.
Исправление: при подмене заполнять `sni`/`host` (и `tlsSettings.serverName` в raw-конфиге) исходным доменом. Ещё лучше — не переписывать адрес, а отдать резолв xray (см. «Упущения»).

**2. Trojan-ссылки теряют REALITY и все транспорты, кроме tcp/ws/grpc.**
`src/main/services/subscription/linkParsing.ts:390`, `:393`. `security=reality` превращается в `tls` (pbk/sid выбрасываются), `type=xhttp|httpupgrade|kcp` — в raw.
Живой трафик: `trojan_reality` FAIL, `trojan_tls_xhttp` FAIL. Те же серверы в JSON-подписке — PASS, то есть проблема только в парсере ссылок.

**3. Mux.Cool включается принудительно для любого публичного Trojan.** _При перепроверке: не баг — документация Trojan требует Mux в публичных сетях (см. «Статус исправлений»)._
`src/main/services/XrayConfigPipeline.ts:1216`, `:1375`, `src/main/services/configGenerator/outboundCompat.ts:287`. Mux включён даже при выключенном в настройках `muxEnabled`. Mux.Cool — протокол только xray/v2ray, и xray его для Trojan не требует.
Воспроизведение: минимальный «обычный» Trojan-сервер (как trojan-gfw) получил от клиента `auth_ok=True cmd=1 dest=v1.mux.cool:9527`. Серверы trojan-gfw/trojan-go (не xray) будут подключаться к несуществующему `v1.mux.cool` — такой сервер в клиенте не работает, и отключить это нельзя.

**4. `alpn` из ссылки игнорируется — XHTTP поверх HTTP/3 не работает.**
`src/main/services/XrayConfigPipeline.ts:934` всегда ставит `["h2","http/1.1"]` (для WS — `["http/1.1"]`).
`vless_xhttp_h3` (`alpn=h3`) — FAIL. Тот же сервер в JSON с `alpn:["h3"]` — PASS. Hysteria2 при этом работает: http3-транспорт xray сам выставляет ALPN.

**5. TCP с HTTP-маскировкой (`headerType=http`) игнорируется.**
Для `type=tcp` параметры `headerType`/`host`/`path` не попадают в `rawSettings.header`. Живой трафик — FAIL, JSON-вариант — PASS. Такие конфиги есть в 3x-ui.

**6. Linux TUN не стартует на системах без IPv6.**
`src/main/services/configGenerator/inbounds.ts:158`, `:173`: всегда добавляются IPv6-шлюз и `::/0`. На ядре без IPv6 xray падает при старте: `proxy/tun: failed to add interface address fd7a:115c:a1e0::1/126 > operation not supported`. Без IPv6-частей тот же конфиг работает.

**7. IPv6-адрес сервера сохраняется в квадратных скобках.**
`src/main/services/subscription/linkParsing.ts:240`, `:373`, `:511` (`URL.hostname` для IPv6 возвращает `[2001:db8::10]`).
Режим прокси работает (xray снимает скобки), но:

- пинг всегда пустой: `PingService.ts:150` → `net.isIP('[::1]') === 0` → DNS-lookup `"[::1]"` → `ENOTFOUND`;
- TUN не подключается: `TunRouteService.ts:728` → `Could not resolve proxy server address: [2001:db8::10]`.

**8. Монитор считает ошибку direct-маршрута блокировкой сервера.**
`src/main/services/ConnectionMonitorService.ts:444`–`:459`. После успешной проверки туннеля монитор сканирует xray.log на `failed to dial`, `tls handshake`, `no route to host` и т. п.
Тест: проверка туннеля «healthy», в лог добавлена одна строка о недоступном исключённом сайте (`proxy/freedom: failed to open connection to tcp:vk.com:80 … failed to dial`). Результат — `health-failure {blocking:true}`, статус `failed`. При выключенном автопереключении политика (`ConnectionPolicy.ts`) сразу отвечает `disconnect` — пользователя отключают без повторной проверки. При включённом — сервер помечается заблокированным до перепроверки.
Срабатывает при уровне лога info/debug: xray пишет такие строки на уровне Info, а пользователю в «Диагностике» предлагают поднимать уровень. По исходнику xray DNS-outbound пишет `failed to dial outbound connection` на уровне Warning (`proxy/dns/dns.go:465`), так что в TUN это возможно и при уровне по умолчанию (не воспроизводилось).

**9. Порт системного прокси чередуется 10808 ↔ 10818 при каждой смене сервера.**
`src/main/domain/connection/ConnectionRuntime.ts:127`. Тест: start, switch, switch, switch → прокси выставлялся на `10809/10808`, `10819/10818`, `10809/10808`, `10819/10818`. Приложения, вручную настроенные на `127.0.0.1:10808` (Telegram, git, расширения браузера), после каждого второго (авто)переключения молча теряют связь. Порт в UI нигде не показывается.

**10. Занятый порт даёт ложный «успешный» старт.**
`src/main/services/XrayService.ts:846`: готовность — это просто успешный TCP-connect к 10808/10809. Те же порты по умолчанию у v2rayN.
Тест: порты заняты сторонним слушателем → `start()` завершился успешно (`running`), через 1,5 с — `failed: Xray exited unexpectedly (code=255)`. Между этими моментами системный прокси указывает на чужой процесс (`bringUp` включает прокси сразу после `start`).

**11. Пользователь не видит, почему xray не запустился.**
`src/main/services/XrayService.ts:793`. На конфиге с `fp=none` пользователь получает `Xray exited during startup (code=23, signal=none)`, хотя xray написал в stdout `unknown "fingerprint": none`.

### Средняя важность

**12. `fp=none` в ссылке ломает запуск.** Значение передаётся как есть (`XrayConfigPipeline.ts:1105`, `:1118`), xray: `unknown "fingerprint": none` (5/5 контекстов). Нужно приравнивать к пустому/дефолтному значению.

**13. Hysteria2 `insecure=1&pinSHA256=…` отвергается клиентом.** `XrayConfigPipeline.ts:973` бросает ошибку из-за `allowInsecure`, хотя пина достаточно, а xray без `allowInsecure` такой конфиг принимает. Для самоподписанных hy2-серверов это частая комбинация. Если есть `pcs`/`pinSHA256`, `insecure` нужно просто отбрасывать.

**14. JSON-подписка с тегом outbound не `proxy` импортируется, но не подключается.** Парсер принимает любой outbound с прокси-протоколом (`jsonParsing.ts:53`), а генератор требует тег `proxy` (`XrayConfigPipeline.ts:344`, `:375`): «Raw config must include an outbound tagged "proxy"». Нужно переименовывать тег (с правкой ссылок в routing) или отбрасывать такой сервер при импорте.

**15. Linux TUN: утечка DNS мимо туннеля.** В netns при поднятом TUN запрос системного резолвера (`resolv.conf` → DNS роутера) пришёл на «LAN-DNS» напрямую с адреса клиента: маршрут локальной сети специфичнее `0.0.0.0/0 dev ultima0`, а правило `port 53 → dns-out` такой запрос не видит. В xray для этого есть `autoSystemDnsToGateway` (systemd-resolved), клиент его не использует.

**16. TUN: DNS-запросы, кроме A/AAAA, получают пустой ответ.** `dns.ts:60` (`rules:[{action:'hijack'}]`). Комментарий в коде утверждает, что всё уходит во встроенный резолвер, но xray отвечает пустым NOERROR и на каждый запрос пишет `[Error] proxy/dns: can only hijack A/AAAA records` (проверено запросом HTTPS/qtype 65). SRV/TXT/MX/HTTPS-записи в TUN не резолвятся, лог засоряется на каждую навигацию браузера.

**17. Linux TUN при маршруте по умолчанию с метрикой 0 не перехватывает трафик.** xray ставит маршрут с `Priority: 1` (`proxy/tun/tun_linux.go:450`). При дефолтном маршруте с метрикой 0 трафик шёл мимо туннеля (на сервере ни одной записи в логе), а клиент считает соединение рабочим: проверка здоровья идёт через локальный SOCKS, а не через TUN. Случай нечастый (DHCP обычно даёт 100/600), но тихий.

### Низкая важность

18. `trojan://` без порта отбрасывается молча (`linkParsing.ts:374`); для `vless://` и `hy2://` используется 443.
19. `ss://…?plugin=obfs-local;obfs=http` — плагин молча выбрасывается, получается нерабочий конфиг. Надо предупреждать или пропускать сервер.
20. `type=h2` и неизвестные типы (`xdrive`, `masque`) молча превращаются в raw вместо понятной ошибки.
21. Предпроверка «публичный ли адрес» расходится с xray (`outboundCompat.ts:47`): клиент считает приватной всю `192.0.0.0/16` (xray — только `192.0.0.0/24` и `192.0.2.0/24`) и не знает про `198.51.100/24`, `203.0.113/24`, `192.88.99/24`. Пример: `vless://…@192.0.5.1:80?security=none` клиент пропускает, xray отвергает.
22. Ошибки главного процесса (112 мест с `throw new Error` на английском) показываются в русском UI как есть; в renderer тоже есть непереведённые строки (`useConnectionActions.ts:32`).

## Производительность (замеры)

| Сценарий                                                             | Результат                                                                                                                     |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| «Реальный» пинг, 100 серверов, localhost (задержка сети ≈0)          | **10,5 с**: по процессу xray на сервер, 6 параллельно (`RealDelayService.ts:33`)                                              |
| TCP-пинг тех же 100                                                  | 86 мс                                                                                                                         |
| Старт xray до готовности порта                                       | 42 мс; 74 мс с geosite-правилами; ~30 МБ RSS на процесс                                                                       |
| Запись пингов в electron-store (весь файл синхронно на каждый `set`) | 100 серверов (0,36 МБ) — 10 мс; 500 (1,8 МБ) — 34 мс; 1500 (5,4 МБ) — 121 мс на запись                                        |
| Ping-all по 1500 JSON-серверам                                       | пачки по 32 результата / 300 мс (`pingAllCoordinator.ts:5`) → ~47 полных перезаписей ≈ **5,7 с блокировки главного процесса** |
| Первый gRPC-запрос статистики                                        | ~0,5 с (установка канала), дальше быстро                                                                                      |

Ещё по коду (не замерялось — нет Windows):

- Режим прокси на Windows: каждое подключение/отключение запускает несколько PowerShell с `Add-Type` (компиляция C# на лету) плюс `schtasks`; по опыту это 1–3 с на операцию.
- Автообновление подписок жёстко раз в 10 минут (`subscriptionRefresh.ts:52`), игнорирует `profile-update-interval`, каждый раз переписывает весь каталог и запускает пинг.
- `domainStrategy: IPIfNonMatch` из JSON-подписки сохраняется, а пользовательская настройка игнорируется: на каждый новый домен — лишний DNS-запрос через прокси.

Что сделано хорошо: коалесцирование снимков и кэш списка серверов (`SnapshotPublisher`), виртуализированный список, кэш DNS в пинге, переиспользование gRPC-клиента.

Рекомендации:

1. Реальный пинг — один процесс xray с N парами inbound→outbound (как в v2rayN) или observatory: на сотню серверов ожидаемо единицы секунд вместо десятков.
2. Каталог хранить отдельным файлом и писать только при обновлении подписок; пинги держать в памяти и сохранять один раз в конце прохода (или в маленький отдельный файл, асинхронно).
3. Системный прокси Windows — `reg.exe` + один заранее собранный helper для `InternetSetOption`, либо один долгоживущий PowerShell.

## Переусложнённость

Объём: main ≈ 20,5 тыс. строк, renderer 7,1 тыс., тесты 13,1 тыс.

| Узел                                                                                             | Строк | Комментарий                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `XrayConfigPipeline.ts`                                                                          | 1407  | Два пути (поля / raw JSON) со своими нормализациями                                                                                                                       |
| Windows TUN (`TunRouteService` + `windowsScripts` + `windowsNativeRouting` + `powerShellRunner`) | ≈2180 | Во многом дублирует то, что xray делает сам (`autoSystemRoutingTable`, `autoOutboundsInterface`, weak host send). Именно закрепление /32 и подмена адреса породили баг №1 |
| Пинг (`pingRefresh` + `pingAllCoordinator` + `PingService` + `RealDelayService`)                 | ≈1450 | Координаторы, «синки», две очереди, фоновые повторы — ради списка задержек                                                                                                |
| Три парсера ссылок                                                                               | ≈780  | Копипаст с разными списками параметров — отсюда баги №2, 4, 5, 18–20                                                                                                      |

Мёртвый и дублирующийся код:

- `src/main/domain/connection/connectionStrategies.ts` (`createConnectionStrategies`, `createNetworkTeardown`, …) используется только тестами; плюс однострочные реэкспорты `services/ConnectionManager.ts` и `services/connection/connectionStrategies.ts`.
- В `applyRawConfig` после `stripUntrustedInbounds` (`:134`) цикл в `ensureLocalProxyInbounds` и ветка `hasTun` (`:140`) недостижимы: inbounds всегда пусты.
- `applyXhttpMaxConnections`: `if (…) return; return;`.
- Дубли `readOutboundAddress`/`readRawOutboundAddress` и `readVlessEncryption`/`readRawVlessEncryption` (pipeline и `outboundCompat`).
- API статистики: tunnel-inbound + правило routing + лишний freedom-outbound `api` (commander всё равно заменяет обработчик, `app/commander/commander.go`). В xray есть `api.listen: "127.0.0.1:PORT"` — все три сущности не нужны.
- Два режима маршрутизации Windows TUN (`xray`/`powershell`) удваивают код и тестовую матрицу.

Рекомендации по коду:

1. Один табличный маппер «параметр ссылки → streamSettings» для vless/trojan (и vmess), общий для всех схем.
2. Удалить PowerShell-режим TUN, закрепление /32 и подмену адреса; положиться на `autoSystemRoutingTable` + `autoOutboundsInterface` + `sockopt.domainStrategy`.
3. Перевести API на `api.listen`.
4. Вычистить мёртвый код выше.

## Упрощение интерфейса

1. Переключение сервера кликом во время подключения. Сейчас при подключении весь список заблокирован (`App.tsx:54`, README: «сначала отключитесь»), хотя бэкенд уже умеет `switchToServer` с транзакционным staging.
2. Пинг в режиме прокси при подключении. Сейчас любой подключённый статус блокирует даже ручной пинг (`pingRefresh.ts:84`), а сокеты Node системный прокси не используют; опасен только TUN.
3. Вкладка «Сеть» показывает ~25 низкоуровневых параметров xray (mux/xudp concurrency, xudpProxyUDP443, sniffing routeOnly, TFO, domainStrategy, fingerprint, MTU, TUN DNS strategy, режим маршрутизации Windows TUN, адаптер, …), и все заблокированы при подключении. Оставить на виду режим, правила маршрутизации, DNS, блокировку рекламы/BT и метод пинга; остальное убрать в «Дополнительно» или удалить (Vision-mux и так принудительно выключается).
4. Смену режима proxy/TUN делать с автоматическим переподключением вместо требования отключиться.
5. Показывать реальную причину ошибки на языке интерфейса и текущий локальный порт прокси.

## Упущения относительно xray и экосистемы

Не баги, а отсутствующие возможности:

- Ссылки `vmess://` не поддерживаются, хотя в подписках они часты (VMess работает только через JSON).
- Параметры ссылок, которых нет: `alpn`, TCP `headerType=http`, gRPC `mode=multi` (`multiMode`), все транспорты и REALITY у Trojan, `upmbps`/`downmbps` у Hysteria2.
- Linux: `autoSystemDnsToGateway`. macOS: TUN в xray поддерживается (`utunN` + `autoSystemRoutingTable`), в клиенте выключен (README говорит обратное).
- Windows: `autoSystemWfpBlockLeak: ["misconfigtun"]` не предлагается.
- DNS-outbound: вместо пустых ответов `{action:'hijack', qType:'1,28'}` + `{action:'direct'}` и `sockopt.dialerProxy:'proxy'` у `dns-out` — остальные типы записей пойдут через туннель.
- Резолв адреса сервера силами xray (`sockopt.domainStrategy` + отдельный direct-резолвер для домена сервера) вместо подмены адреса на IP.
- Подписки: нет `User-Agent` (Node шлёт свой; Remnawave/Marzban/3x-ui выбирают формат по UA, некоторые отказывают неизвестным клиентам), нет HWID-заголовков (Remnawave), игнорируются `subscription-userinfo` / `profile-update-interval` / `profile-title`; загрузка идёт напрямую даже при подключении (заблокированные домены подписок — нужен вариант «обновлять через прокси»).
- Предпроверка `xray run -test` или разбор строки `Failed to start:` для внятной ошибки.
- В JSON-подписках правила `direct` вроде `geosite:category-ru` удаляются (осознанное решение по безопасности, но пользователю это не видно).

## Что работает хорошо

- Санитизация raw-конфигов: inbounds, webhook-и, `routing.script`, `api.services`, `dns.hosts` вырезаются; HTTPS-only подписки с SSRF-проверкой всех адресов.
- Миграции удалённых в xray 26 полей (`proxySettings` → `dialerProxy`, `quicParams.udpHop` → `udphop`, KCP `seed`/`header` → `mkcp-legacy`, WireGuard `domainStrategy` → `targetStrategy`, REALITY `publicKey` → `password`) — xray их принимает, трафик идёт.
- Работают живьём: REALITY/Vision, XHTTP (TLS и REALITY), gRPC, WS (+early data), HTTPUpgrade, SS-2022, SS+WS+TLS, Hysteria2 (+salamander), VLESS Encryption, VMess (JSON), fragment, балансировщик.
- Статистика через gRPC корректна.
