# UltimaVLESS — аудит кодовой базы

**Репозиторий:** https://github.com/sliva-name/ultimaVLESS  
**Версия в дереве:** `7.11.1` (`package.json`)  
**Коммит базы:** `b3c4ba6` (`chore(release): v7.11.1`, включает merge PR #46 / issue #45)  
**Дата аудита:** 2026-09-07  
**Тесты:** `npm run test:run` — **188 passed / 21 files** (vitest 4.1.8)

Это отчёт по чтению кода, а не патч. Исправления сознательно не внесены (кроме самого документа). Политику TLS/REALITY ослаблять не предлагается.

---

## 1. Краткое резюме

Архитектура сессии (фаза → runtime → Xray) в целом здоровая: очередь операций, abort, транзакционный proxy-switch, санитайзинг inbounds/DNS/routing для JSON-подписок, IPC sender check, `toSafeServer` без секретов. Issue #45 (залипание выбора сервера в `failed` + фильтр несовместимого public VLESS) **подтверждён как исправленный** в текущем `main`.

Реальных **Critical** (удалённый RCE / обход TLS-политики клиента) нет.

Главные риски — два класса:

1. **Безопасность raw JSON.** Пайплайн уже не доверяет подписке (выкидывает inbounds, режет routing, переписывает DNS), но **не проверяет протокол outbound `proxy`** и **не перезаписывает `cfg.api`**. Враждебный JSON может превратить «VPN» в `freedom` (трафик идёт напрямую) или оставить на `127.0.0.1:10810` лишние gRPC-сервисы Xray.
2. **Производительность каталога 200–300 серверов.** Ping-all каждые 8 результатов синхронно делает `saveAll` всего каталога + полный `buildAppSnapshot`. Тот же полный снимок уходит на каждый тик трафика (~1 с). Это совпадает с логами issue #45 (`saveAll` × десятки раз при ~300 серверах).

Окно восстановления рендерера при `recoveryBlocked` по-прежнему **не эскалирует** в fatal/relaunch — после трёх попыток за 60 с пользователь может остаться с мёртвым окном.

| Серьёзность | Кол-во |
|-------------|--------|
| Critical    | 0      |
| High        | 5      |
| Medium      | 12     |
| Low         | 11     |

---

## 2. Объём

Систематически просмотрены:

| Область | Пути |
|---------|------|
| Electron main / bootstrap | `src/main/main.ts`, `runtime/*`, `preload.ts` |
| Сессия / data plane | `domain/connection/*`, `services/ConnectionManager.ts` (shim), `XrayService.ts`, `ConnectionMonitorService.ts`, `AppRecoveryService.ts` |
| Конфиг Xray | `XrayConfigPipeline.ts`, `XrayConfigCompiler.ts`, `configGenerator/*` |
| IPC | `ipc/**`, `shared/ipc*` |
| Ping / persistence | `PingService.ts`, `ElectronServerRepository.ts`, `appStore.ts` |
| Подписки | `SubscriptionService.ts`, `subscription/*`, `subscriptionUrls.ts` |
| TUN / proxy / privilege | `TunRouteService.ts`, `tunRoute/*`, `systemProxy/*`, `PrivilegeService.ts` |
| Renderer | `App.tsx`, `hooks/*`, `components/**` |
| Shared | `shared/**` |
| Тесты | `src/test/**` (21 файл) |
| Сборка / скрипты | `package.json` `build`, `scripts/*`, `vite.config.ts`, `.github/workflows/*` |
| Сайт | `website/` — только обзор, логики VPN нет |

Не запускались: упакованный Electron, e2e GUI, TUN на живой ОС.

---

## 3. Проверка уже известных заметок

| Заметка | Статус | Доказательство |
|---------|--------|----------------|
| Issue #45 / PR #46: выбор сервера в `failed` | **Верно, в main** | `isSessionPhaseSelectable` = `idle \|\| failed` (`src/shared/views/appSnapshot.ts`). Renderer: `selectionLocked={isConnectionBusy \|\| isConnected}` (`App.tsx`) — `failed` не лочит список. |
| Фильтр несовместимого public VLESS | **Верно** | `ConnectionPolicy` передаёт `isEligible: isServerPublicOutboundCompatible`. Snapshot помечает `outboundCompatible: false`. |
| Ping-all → `saveAll` + полный snapshot каждые ~8 результатов | **Верно, и хуже** | `PARTIAL_UPDATE_BATCH_SIZE = 8`; `onResult` синхронно зовёт `persistPingResults` → `saveAll` + `notifySnapshot('ping')`. |
| `did-finish-load` всегда зовёт `completeRecovery()` | **Верно** | `finally` в `src/main/main.ts`. |
| `recoveryBlocked` не эскалирует | **Верно** | `attemptWindowRecovery` логирует и `return`; `scheduleFatalExit` не вызывается. |
| Два пути: `unexpected-exit` + `health-changed failed` | **Верно** | `maybeEmitUnexpectedExit` → `markFailed` (эмит `health-changed`) затем `unexpected-exit`. |
| `unexpected-exit` игнорируется, если phase ≠ `connected` | **Верно** | `ConnectionRecovery.handleUnexpectedXrayExit`. |
| Тонкие тесты AppRecovery | **Верно** | Нет unit-тестов `AppRecoveryService`. `connection-recovery.test.ts` — 3 кейса, без dual-path и `recoveryBlocked`. |

---

## 4. High

### H1. Raw JSON: outbound `proxy` может быть `freedom` — полный bypass туннеля

**Файлы:** `src/main/services/XrayConfigPipeline.ts` (`ensureAuxiliaryOutbounds`, `assertRawOutboundCompatibility`, `sanitizeRawRoutingRules`, `ALLOWED_RAW_OUTBOUND_TAGS`)

**Что делает код.** Для `rawConfig` пайплайн:

- разрешает routing rules с `outboundTag: "proxy"` (`ALLOWED_RAW_OUTBOUND_TAGS`);
- **добавляет** `direct`/`block`, только если тегов нет — существующий `proxy` не валидируется;
- `assertRawOutboundCompatibility` смотрит **только** протоколы из `isTunableProxyProtocol` (`vless|vmess|trojan|shadowsocks|hysteria|wireguard`). `freedom` / `blackhole` / `dns` пропускаются.

Подписка может отдать:

```json
{ "tag": "proxy", "protocol": "freedom", "settings": {} }
```

плюс catch-all rule `outboundTag: "proxy"`. Клиент покажет обычный сервер, Xray стартует, трафик уходит в интернет **напрямую**.

`isServerPublicOutboundCompatible` тоже смотрит только vless/trojan/hysteria в raw outbounds; если их нет — падает обратно на structured fields. JSON с `freedom` + «нормальными» полями карточки проходит UI-фильтр issue #45.

**Почему важно.** Это дыра в том самом trust boundary, который пайплайн уже пытается закрыть (inbounds выкидываются именно потому, что raw config не доверенный). Field-based `vless://` не затронут.

**Исправление.** После clone raw config:

- outbound с `tag === "proxy"` обязан быть одним из tunable proxy-протоколов;
- `block` → только `blackhole`; `direct` → только `freedom`;
- иначе throw (как при отсутствии TLS у public VLESS).

Тест: raw `{ tag: "proxy", protocol: "freedom" }` + rule на `proxy` должен падать в `compile`.

Не ослаблять TLS/REALITY checks — это дополнение к ним.

---

### H2. Raw JSON: `cfg.api` не перезаписывается — можно включить HandlerService на loopback

**Файл:** `src/main/services/configGenerator/statsApi.ts`

```ts
cfg.stats = cfg.stats ?? {};
cfg.api = cfg.api ?? { tag: 'api', services: ['StatsService'] };
```

`??` сохраняет объект из подписки. Inbound API клиент всё равно вешает на `127.0.0.1` + фиксированный порт `APP_CONSTANTS.PORTS.API` (`10810`). Если raw задаёт `services: ["HandlerService", "LoggerService", "StatsService"]`, любой локальный процесс получает gRPC API управления **уже запущенным** Xray (в TUN — часто elevated).

**Почему важно.** Пайплайн специально выкидывает чужие inbounds, чтобы подписка не открыла listener. Через `api.services` тот же эффект достигается на порту, который клиент открывает сам.

**Исправление.** Всегда присваивать `cfg.api = { tag: 'api', services: ['StatsService'] }`. Не мержить. Тест на raw `HandlerService`.

---

### H3. Ping-all: синхронный `saveAll` + полный snapshot каждые 8 результатов

**Файлы:** `src/main/ipc/handlers/pingHandlers.ts`, `src/main/services/PingService.ts`, `src/main/infrastructure/persistence/ElectronServerRepository.ts`, `src/main/runtime/SnapshotPublisher.ts`

`PARTIAL_UPDATE_BATCH_SIZE = 8`. `PingService.pingServers` вызывает `onResult` **внутри воркера, до следующего ping**. Обработчик:

1. `serverRepository.list()` — hydrate overlay + `uniqueCatalogServers` + fingerprint **включая `rawConfig`**;
2. `saveAll` — два синхронных `electron-store.set` на весь каталог + весь ping overlay;
3. `notifySnapshot('ping')` → `buildAppSnapshot` → снова `list()`, `toSafeServerList`, IPC всего списка.

На 300 серверах ≈ 37 partial + 1 final. Логи issue #45 это показывают буквально (`saveAll` count 301 / 284 пачками).

**Почему важно.** Main thread блокируется диском и сериализацией; ping-all сам тормозит; UI на больших каталогах «замирает» — ровно тот сценарий, в котором пользователь потом упирался в failed-session.

**Исправление (quick wins):**

- не вызывать persist/snapshot из `onResult` синхронно — debounce 200–500 ms / `setImmediate`;
- писать только overlay ping (`serverPings`), не весь `servers`;
- во время ping-all слать ping-delta, полный snapshot — в конце;
- увеличить batch или привязать к `n` (`Math.max(32, ceil(n/10))`).

---

### H4. `SnapshotPublisher.push` всегда собирает полный AppSnapshot, без coalesce

**Файл:** `src/main/runtime/SnapshotPublisher.ts`

`push(_reason)` игнорирует reason и каждый раз делает `buildAppSnapshot` + `webContents.send`. Подписчики:

- `traffic` — до 1 Гц при живом трафике (`TrafficStatsService`, `POLL_INTERVAL_MS = 1000`);
- `process` — каждый poll готовности Xray (~50 ms), см. M3;
- `ping` — см. H3;
- `connection` / `health` / `recovery`.

`buildAppSnapshot` каждый раз: `list()` → `toSafeServerList` (ещё раз `uniqueCatalogServers`) → `isServerPublicOutboundCompatible` на каждый сервер → JSON-fingerprint кэша safe-list.

**Почему важно.** На сессии с 200–300 серверами main и renderer постоянно гоняют полный каталог ради счётчика байт.

**Исправление.** Coalesce (50–100 ms). Кэшировать срезы `servers`/`subscriptions` по generation. Для `traffic`/`process` — узкий канал, не полный snapshot.

---

### H5. Фоновый retry ping-all гоняется вне очереди и может затереть свежие RTT

**Файл:** `src/main/ipc/handlers/pingHandlers.ts` (`runPingAllServers`)

Основной прогон сериализуется через `pingAllQueue`. Retry после `RETRY_DELAY_MS` запускается `void (async () => { ... pingServers(failedServers); persistPingResults(retryResults) })()` **вне очереди**.

`persistPingResults` сравнивает `catalogListFingerprint` (без ping-полей). Второй ping-all не меняет каталог → retry первого прогона имеет право сделать `mergePingResults(latest, retryResults)` и откатить RTT, которые уже обновил второй прогон.

**Исправление.** Retry тоже в `pingAllQueue`, либо monotonic `pingGeneration` + отмена retry при новом ping-all.

---

## 5. Medium

### M1. Dual-path смерти Xray: `health-changed failed` и `unexpected-exit` оба зовут `handleRuntimeFailure`

**Файлы:** `XrayService.maybeEmitUnexpectedExit`, `registerRuntimeEvents.ts`, `ConnectionManager.handleRuntimeFailure`

`markFailed` эмитит `health-changed`; затем `unexpected-exit`. Оба пути вызывают `handleRuntimeFailure` → `noteFailure` **до** проверки `state === 'connected'`. `healthPolicyArmed` спасает от двойного auto-switch (однопоточный JS), но:

- `noteFailure` / monitor `error` / tray error — дважды;
- разные префиксы сообщения (`Connection lost: …` vs raw reason);
- третий вход — periodic probe `health-failure`.

**Исправление.** Один вход «процесс мёртв». `health-changed failed` — только snapshot, если будет `unexpected-exit`; либо generation-token в `handleRuntimeFailure`.

Тесты dual-path сейчас отсутствуют.

---

### M2. `recoveryBlocked` глушит восстановление окна без fatal/relaunch

**Файл:** `src/main/main.ts` (`attemptWindowRecovery`)

После 3 попыток за 60 с (`AppRecoveryService`, `MAX_RECOVERY_ATTEMPTS`) recovery просто не стартует. Рендерер может остаться мёртвым (unresponsive / render-process-gone / did-fail-load). Пользователю остаётся убить процесс.

`did-finish-load` в `finally` всегда зовёт `completeRecovery()` — в том числе на **первой** загрузке, когда recovery не было. Это маскирует статус в диагностике.

**Исправление.** При `recoveryBlocked`: показать диалог / tray «перезапустить приложение» или `scheduleFatalExit` с teardown Xray (как у uncaughtException). `completeRecovery` из `did-finish-load` — только если `recoveryInProgress`.

Unit-тестов `AppRecoveryService` нет.

---

### M3. Спам snapshot на readiness poll Xray

**Файл:** `XrayService.awaitLocalProxyReadiness` → `setHealthStatus` каждые `READINESS_RETRY_MS` (50 ms) с новым `lastReadinessCheckAt`. Любое отличие поля эмитит `health-changed` → полный snapshot (`registerRuntimeEvents`).

Окно готовности 3 с → десятки полных снимков на каждый connect/switch.

**Исправление.** Пушить process-snapshot только при смене `state` / `ready` / `xrayRunning`, не на каждый poll.

---

### M4. Runtime failure без сервера в каталоге оставляет session `connected`

**Файл:** `ConnectionManager.handleRuntimeFailure`

Если `this.servers.get(this.state.serverId)` пуст (сервер удалили во время сессии, uuid collision после refresh), метод логирует warn и **return**, не вызывая `cleanupAfterFailure`. UI: Connected, data plane мёртв, auto-switch не стартует.

**Исправление.** Fallback `cleanupAfterFailure(reason)` при `state === 'connected'` и отсутствии сервера.

---

### M5. SSRF: TOCTOU DNS rebinding на fetch подписки

**Файл:** `src/main/services/SubscriptionService.ts` (`validateRemoteSubscriptionUrl`)

HTTPS-only, private host block, resolve **всех** A/AAAA, fail-closed по DNS timeout, redirect re-validate — сделано хорошо. Код сам документирует окно: между lookup и `fetch` authoritative DNS с TTL=0 может подменить ответ на RFC1918.

**Исправление.** Pin: соединяться на уже проверенный IP, SNI/Host — исходный hostname. Не обязательно для v1, но это единственный оставшийся SSRF-зазор.

---

### M6. URL подписки не валидируется на IPC-границе

**Файл:** `src/main/ipc/validators.ts` (`normalizeAddSubscriptionPayload`)

Проверяются длина имени/URL, не схема. `http://`, мусор и intranet-looking URL пишутся в store; HTTPS/private проверяются только в `fetchAndParse`. Авто-refresh будет стабильно ошибаться.

**Исправление.** На add/update: `https:` + `new URL` + тот же host policy, что у fetch (или хотя бы схема).

---

### M7. Дефолтная подписка создаётся и фетчится без согласия

**Файл:** `src/main/infrastructure/persistence/appStore.ts` (`migrateLegacySubscriptionUrl`)

Пустой store → подписка `Default` на `YANDEX_TRANSLATED_MOBILE_LIST_URL`. `loadInitialState` ставит refresh в очередь. Первый запуск стучится в Yandex Translate + origin списка.

**Исправление.** Пустой список + онбординг «добавить подписку»; не фетчить, пока пользователь не подтвердил.

---

### M8. Сырые поля raw config, которые пайплайн не чистит

**Файл:** `XrayConfigPipeline.applyRawConfig`

Живут без санитайза: `env`, `reverse`, `fakedns`, `routing.balancers`, `policy` (мержится в `applyStatsApi`, не заменяется), `version.max` из подписки.

Inbounds/DNS/rules режутся. Эти поля — остаточный surface (FakeDNS, reverse portal, env core, balancer без rules — мёртвый, но `version.max` может не дать Xray стартовать).

**Исправление.** Для client-owned конфига удалять `env`/`reverse`/`fakedns`/`routing.balancers`; `policy` собирать самим; `version` — только `min: bundled`.

---

### M9. После sleep `HOST_FAIL` при re-pin маршрутов только warn

**Файл:** `TunRouteService.reapplyRoutesAfterResume`

Не удалось поставить host /32 после смены шлюза — warn, session остаётся `connected`. Классический «Connected, но интернета нет», пока periodic probe не сработает.

**Исправление.** Любой `HOST_FAIL` → `triggerImmediateHealthCheck` с blocking reason (probe после resume уже есть, но он идёт даже при успехе; при fail стоит форсировать reconnect/auto-switch).

---

### M10. `setPerformanceSettings` не закрыт на connected (UI закрыт, IPC нет)

**Файлы:** `settingsHandlers.ts`, `SettingsNetworkTab.tsx` (`networkLocked`)

UI дизейблит Save при connected. IPC всегда принимает. Xray читает perf только в `start`/`compile` — настройки в store «применены», туннель старый до reconnect.

**Исправление.** Как у `setConnectionMode`: reject, если phase in-flight/connected.

---

### M11. Linux TUN: нет orphan recovery, teardown «на Xray»

**Файлы:** `TunRouteService.disable`, `tunRoute/platformAdapter.ts`

Windows: stale sweep + recoverOrphanedRoutes на старте. Linux: disable — no-op (делегировано процессу Xray); `recoverOrphanedRoutes` сразу return. Hard-kill может оставить маршруты/DNS.

**Исправление.** Задокументировать + startup probe default route / TUN iface по аналогии с Windows.

---

### M12. Лишние полные snapshot: delete subscription ×2, ping-all + renderer refresh

**Файлы:** `subscriptionHandlers.ts` (notify до и после `saveAll`); `useAppSnapshot.tsx` (`pingAllServers` после invoke ещё `refreshSnapshot()` → третий полный `getAppSnapshot`).

**Исправление.** Один notify после обеих мутаций. После ping-all не звать `getAppSnapshot`, если финальный push уже ушёл.

---

## 6. Low

### L1. `completeRecovery` сразу после `loadRenderer` / `createWindow`

`attemptWindowRecovery` помечает recovery завершённой до `did-finish-load` / `loadInitialState`. Диагностика врёт на сотни мс. Дублируется `finally` в `did-finish-load` (см. M2).

### L2. `switchToServer` при ошибке staging оставляет data plane живым, session → `failed`

`ConnectionRuntime.switchProxyTransaction` при ошибке **намеренно** откатывает proxy на старый процесс и не kill'ает его. `enqueue` catch всё равно переводит session в `failed` и **не** зовёт `runtime.stop()`.

Прод-UI меняет сервер через `connect()` → `runtime.start()` (сначала `tearDown`) — путь безопасный. `switchToServer` живёт в API и в `session.test.ts`. Auto-switch сам вызывает `runtime.stop()` если все кандидаты умерли.

Имеет смысл либо вернуть session в `connected` при успешном rollback, либо stop, либо убрать public `switchToServer` в пользу `connect`.

### L3. IPC глотает ошибки: ping-all → `[]`, `getLogs` → `''`, disconnect без `error`

Renderer считает пустой ping успехом; disconnect показывает общее «Failed to disconnect cleanly».

### L4. `config.json` / `config-staging.json` на диске с секретами, без `mode 0o600`

Ожидаемо для локального VPN-клиента; на Unix стоит `chmod 0o600`. `electron-store` (`app-config.json`) тоже plaintext (UUID, пароли, `rawConfig`).

### L5. Access-лог Xray при `logLevel === 'debug'`

Сознательно, `maskAddress: 'full'`. Имеет смысл предупреждение в UI диагностики (destinations попадают в export).

### L6. Дубль `MIN_PING_INTERVAL_MS = 30_000` vs `DEFAULT_MIN_PING_INTERVAL_MS`

### L7. `SnapshotReason` не используется — нельзя приоритизировать/coalesce по типу

### L8. `pingServer` IPC не вызывается из renderer (только preload/mock)

Хендлер корректно берёт сервер из store по uuid, не из payload — если UI появится, это правильная модель.

### L9. Транзакционный proxy-switch не фоллбечится на полный tear-down

Staging fail → throw, хотя cold start мог бы пройти. Сознательный tradeoff latency vs сложность.

### L10. Linux system proxy только GNOME/gsettings; macOS TUN unsupported

Оба fail-fast / UI-blocked. Не баги, пробелы платформ.

### L11. `toSafeServerList` заново гоняет `uniqueCatalogServers` (уже в `list()`) и строит fingerprint через `JSON.stringify` всех строк

Усиливает H4; отдельно — дешёвый win: кэш по catalog generation, не по сериализации.

---

## 7. Мёртвый / лишний код

| Что | Где | Комментарий |
|-----|-----|-------------|
| `createConnectionStrategies` / `createNetworkTeardown` | `src/main/domain/connection/connectionStrategies.ts` | В проде не импортируется; только `connection-strategies.test.ts`. Runtime = `ConnectionRuntime` + `NetworkModeRuntime`. |
| Re-export shim | `src/main/services/connection/connectionStrategies.ts` | Никто не импортирует. |
| Re-export shim | `src/main/services/ConnectionManager.ts` | Прод импортирует `domain/connection/ConnectionManager`. |
| `buildSubscriptionGroups` / `buildOrphanSubscriptionServers` / `buildManualServers` | `sidebarModel.ts` | Обёртки над `buildSidebarServerBuckets`; Sidebar использует buckets напрямую. |
| `SubscriptionRepository.saveAll` | interface + `ElectronSubscriptionRepository` | Нет вызовов в `src/`. |
| Событие монитора `'blocked'` | `ConnectionMonitorService` type + `registerRuntimeEvents` | Никогда не `emit`. UI диагностики готов рисовать `event.type === 'blocked'`. |
| `state-changed` | `ConnectionManager.emit` + `removeAllListeners('state-changed')` | Подписчика нет; слушают `phase-changed`. |
| `installLogonRecoveryTask` / `uninstallLogonRecoveryTask` | `windowsProxyRecovery.ts` | Алиасы, никем не импортируются. |
| `switchToServer` | `ConnectionManager` | Только тесты; UI — `connect(uuid)`. |

Закомментированных мёртвых блоков в просмотренных файлах нет. `useRenderPerf` живой (dev/debug).

`npm audit --omit=dev`: транзитивные moderate/high (`@sentry/*` / OpenTelemetry, `protobufjs` через `@grpc/grpc-js`, `js-yaml` / `fast-uri` / `brace-expansion` в цепочке updater/sentry). Практического VPN-эксплойта из них не видно; не раздувать в High.

---

## 8. Performance — быстрые победы

Порядок по ROI при каталоге 200–300:

1. **Coalesce `SnapshotPublisher`** (50–100 ms, merge reasons). Сразу режет traffic 1 Hz и ping bursts.
2. **Не собирать полный snapshot на `traffic` / readiness poll.** Узкий event для байт/bps и process flags.
3. **Ping persist:** debounce; писать только `serverPings`; убрать sync `saveAll` из `onResult`.
4. **Кэш `serverRepository.list()`** в памяти, invalidate на `saveAll`. Сейчас каждый `list()`/`get()` — store + hydrate + fingerprint всего каталога.
5. **Исключить `rawConfig` из `getServerConfigFingerprint`** (отдельный hash при connect). Сейчас identity walk сериализует вложенный JSON на каждый list/save/snapshot.
6. Убрать второй `uniqueCatalogServers` в `toSafeServerList` и fingerprint через `JSON.stringify` всех safe-rows.
7. Renderer: не вызывать `refreshSnapshot()` после `pingAllServers`.
8. Delete subscription: один `notifySnapshot`.

`PingService.MAX_CONCURRENT_PINGS = 20` и TLS-кэш выглядят адекватно. Проблема не в числе сокетов, а в синхронной работе на main после каждого батча.

---

## 9. Что выглядит здорово

- **Граница renderer:** `contextIsolation: true`, `nodeIntegration: false`, `assertTrustedSender` по `webContents.id`, `will-navigate` allowlist, `setWindowOpenHandler(deny)`.
- **Секреты в UI:** `toSafeServer` / `toSafeServerList` режут uuid пользователя, пароли, `rawConfig` (покрыто `security.test.ts`).
- **Подписочный fetch:** HTTPS, private IP, all-addresses DNS, fail-closed, manual redirects с re-validate, cap тела 5 MB, redact URL в логах.
- **Xray field-based + большая часть raw:** чужие inbounds выкинуты; DNS подписки заменяется целиком; `allowInsecure` запрещён; public VLESS/Trojan/Hysteria требуют TLS/REALITY/encryption; Vision mux off; public Trojan mux on; split tunnel без `regexp:`; private → `direct`.
- **Сессия:** `ALLOWED_TRANSITIONS`, serial queue, abort предыдущей операции, `healthPolicyArmed`, expected vs unexpected Xray exit (`WeakSet`).
- **Proxy switch:** staging ports + rollback + abortStaging — хорошо покрыто `connection-runtime.test.ts`.
- **Issue #45:** `failed` selectable; несовместимые public outbound помечаются и не берутся auto-switch.
- **Windows TUN:** один PowerShell batch, host /32, rollback на enable fail, orphan recovery на старте, UAC relaunch + `RELAUNCH_ARG` + pending TUN.
- **System proxy:** snapshot-before-mutate, Windows logon recovery, не трогает «чужой» proxy (лог `Left foreign proxy configuration untouched` — сознательно).
- **Power resume:** re-pin host routes затем immediate health check.
- **Очередь подписок:** serial refresh, partial errors не затирают весь каталог (`preserveActiveServerIfNeeded`).
- **Тесты:** 188 штук по xray-config/dns/routing/outbound, session, runtime, subscriptions, catalog, tun, security, UI session. Пробелы — recovery dual-path, AppRecoveryService, raw `proxy`/`api` adversarial cases, ping persist races.

---

## 10. Предлагаемый порядок фикса

1. **H1 + H2** — валидация raw outbound tags + always-overwrite `cfg.api` (тесты adversarial JSON). Не трогать TLS/REALITY asserts.
2. **H4** — coalesce snapshot + не слать полный каталог на traffic/process poll. Самый заметный UI-лаг на больших списках и на сессии.
3. **H3 + H5 + M12** — ping persist debounce, overlay-only write, generation на retry, убрать лишний `refreshSnapshot`.
4. **M8** — strip `env`/`reverse`/`fakedns`/`balancers`.
5. **M1 + M4** — один путь смерти Xray; cleanup если сервера нет в каталоге.
6. **M2** — эскалация `recoveryBlocked` + тесты `AppRecoveryService`.
7. **M3, M6, M9, M10** — мелкие, локальные.
8. **M5** — DNS pin, если threat model включает враждебный DNS на URL подписки.
9. **M7, M11, Low, dead code** — продукт/гигиена.

Оценка объёма: H1/H2 — точечные asserts в пайплайне; H3/H4 — чуть больше (издатель снимков + ping IPC), но без смены модели сессии.

---

## 11. Покрытие тестами (факт прогона)

```
vitest run --reporter=dot
Test Files  21 passed (21)
Tests       188 passed (188)
Duration    4.44s
```

Не гонялись: `typecheck`/`lint` в этом прогоне, Electron e2e, упакованный NSIS/AppImage.

Пробелы, которые стоит закрыть вместе с фиксами:

- raw `{ tag: "proxy", protocol: "freedom" }` должен throw;
- raw `api.services` включает `HandlerService` — в скомпилированном конфиге только `StatsService`;
- ping-all: два прогона + in-flight retry не затирает overlay;
- `handleRuntimeFailure` без catalog server → cleanup;
- `AppRecoveryService` blocked / prune / completeRecovery;
- dual-path `health-changed` + `unexpected-exit` не вызывает политику дважды.
