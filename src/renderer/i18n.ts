import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

const resources = {
  en: {
    translation: {
      "app": {
        "title": "UltimaVLESS",
        "subtitle": "VLESS VPN Client"
      },
      "sidebar": {
        "servers": "Servers",
        "pingAll": "Ping all",
        "settings": "Settings",
        "noServers": "No servers or subscriptions added yet.",
        "ms": "ms",
        "connected": "Connected",
        "subscriptionShort": "Subscription",
        "manualShort": "Manual"
      },
      "status": {
        "secure": "SECURE",
        "disconnected": "DISCONNECTED",
        "connecting": "Connecting...",
        "disconnecting": "Disconnecting...",
        "connectedTo": "Connected to {{name}}",
        "readyToConnect": "Ready to connect to {{name}}",
        "selectServer": "Select a server to connect",
        "connectingHint": "Applying TUN/proxy settings and network routes. This can take a few seconds.",
        "disconnectingHint": "Applying disconnect sequence and cleaning routes.",
        "country": "Country",
        "ipAddress": "IP Address",
        "protocol": "Protocol",
        "connectionActive": "Connection Active"
      },
      "settings": {
        "title": "Settings",
        "subtitle": "Sources, routing, and connection health",
        "close": "Close settings",
        "navAria": "Settings sections",
        "tabs": {
          "sources": "Sources",
          "network": "Network",
          "diagnostics": "Diagnostics"
        },
        "sources": {
          "subscriptions": "Subscriptions and imports",
          "noSubscriptions": "No subscriptions yet. Add one below.",
          "addSubscription": "Add subscription",
          "namePlaceholder": "Name (e.g. Work VPN)",
          "urlPlaceholder": "https://example.com/sub",
          "addAndFetch": "Add and fetch",
          "adding": "Adding...",
          "openPreview": "Open preview and import mobile list",
          "manualConfigs": "Manual configs (multi-paste)",
          "manualPlaceholder": "Paste any text from clipboard. All vless:// and trojan:// links will be extracted.",
          "manualHint": "Mixed clipboard text is fine; links are extracted automatically.",
          "saveManual": "Save manual",
          "saving": "Saving...",
          "removeSubscription": "Remove subscription",
          "enableSubscription": "Enable subscription",
          "disableSubscription": "Disable subscription",
          "errors": {
            "nameRequired": "Name is required",
            "urlRequired": "URL is required",
            "fetchFailed": "Failed to fetch subscription",
            "addFailed": "Failed to add subscription",
            "loadFailed": "Could not load configs.",
            "saveManualFailed": "Failed to save manual links"
          }
        },
        "network": {
          "mode": "Network mode",
          "proxyMode": "Proxy mode",
          "proxyDesc": "System proxy for typical desktop apps.",
          "tunMode": "TUN mode",
          "tunDesc": "Full system traffic. May require elevated privileges.",
          "disconnectHint": "Disconnect before changing mode. The choice applies on the next connection.",
          "disconnectHintError": "Disconnect before changing connection mode.",
          "tunUnavailable": "TUN mode is not supported on this operating system.",
          "tunUnsupportedDarwin": "TUN mode is currently supported only on Windows and Linux by the bundled Xray core.",
          "tunElevated_win32": "TUN mode needs Administrator rights. Connect in TUN mode and approve the UAC prompt (or run UltimaVLESS as Administrator).",
          "tunElevated": "Run UltimaVLESS with root privileges for TUN mode.",
          "tunDegradedLinux": "Linux TUN routing currently relies on Xray auto-route behavior rather than explicit OS-level route teardown.",
          "routingMode": "Routing mode: {{mode}}",
          "performance": "Performance tuning",
          "performanceHint": "Changes take effect on the next connection.",
          "performanceLocked": "Disconnect the VPN to change performance settings.",
          "muxEnabled": "TCP Mux",
          "muxEnabledHint": "Multiplex TCP connections. Reduces latency but may lower throughput for downloads.",
          "muxConcurrency": "Mux concurrency",
          "muxConcurrencyHint": "Max sub-connections per Mux link (1–128).",
          "xudpConcurrency": "XUDP concurrency",
          "xudpConcurrencyHint": "Max concurrent UDP sub-connections (1–1024).",
          "xudpProxyUDP443": "UDP/443 (QUIC) policy",
          "xudpProxyUDP443Hint": "How to handle QUIC traffic through the proxy.",
          "udp443Reject": "Reject (fallback to TCP)",
          "udp443Allow": "Allow via Mux",
          "udp443Skip": "Skip Mux (native UDP)",
          "tcpFastOpen": "TCP Fast Open",
          "tcpFastOpenHint": "Send data in the SYN packet to reduce connection latency.",
          "sniffingRouteOnly": "Sniffing route-only",
          "sniffingRouteOnlyHint": "Use sniffing results only for routing, don't override destination.",
          "logLevel": "Log level",
          "logLevelHint": "Xray core verbosity. Use 'debug' for troubleshooting.",
          "fingerprint": "TLS fingerprint",
          "fingerprintHint": "Default browser fingerprint for anti-detection. Per-server value takes priority.",
          "blockAds": "Block ads",
          "blockAdsHint": "Block known ad domains via geosite:category-ads-all.",
          "blockBittorrent": "Block BitTorrent",
          "blockBittorrentHint": "Prevent BitTorrent traffic through the proxy.",
          "domainStrategy": "Domain strategy",
          "domainStrategyHint": "DNS resolution strategy for routing rules.",
          "resetDefaults": "Reset to defaults"
        },
        "diagnostics": {
          "monitoring": "Connection monitoring",
          "autoSwitching": "Auto server switching",
          "autoSwitchingDesc": "Switch to another server when the current one looks blocked.",
          "currentServer": "Current server",
          "blockedServers": "Blocked servers",
          "lastError": "Last error",
          "xrayState": "Xray state",
          "lastHealthCheck": "Last health check",
          "healthState": "Health state",
          "localProxy": "Local proxy reachable",
          "healthFailure": "Health failure",
          "xrayFailure": "Xray failure",
          "recoveryInProgress": "Recovery in progress ({{count}})",
          "recoveryPaused": "Recovery paused after {{count}} attempts",
          "lastFatal": "Last fatal reason",
          "lastRecovery": "Last recovery",
          "clear": "Clear",
          "recentEvents": "Recent events",
          "serverShort": "Server {{id}}…",
          "eventTypes": {
            "connected": "Connected",
            "disconnected": "Disconnected",
            "error": "Error",
            "blocked": "Blocked",
            "switching": "Switching server"
          },
          "troubleshooting": "Troubleshooting",
          "copyLogs": "Copy logs",
          "copied": "Copied!",
          "openFolder": "Open folder",
          "sanitizedHint": "Logs are sanitized to remove sensitive personal data"
        }
      }
    }
  },
  ru: {
    translation: {
      "app": {
        "title": "UltimaVLESS",
        "subtitle": "VLESS VPN-клиент"
      },
      "sidebar": {
        "servers": "Серверы",
        "pingAll": "Пинг всех",
        "settings": "Настройки",
        "noServers": "Серверы или подписки пока не добавлены.",
        "ms": "мс",
        "connected": "Подключено",
        "subscriptionShort": "Подписка",
        "manualShort": "Ручные"
      },
      "status": {
        "secure": "ЗАЩИЩЕНО",
        "disconnected": "ОТКЛЮЧЕНО",
        "connecting": "Подключение...",
        "disconnecting": "Отключение...",
        "connectedTo": "Подключено к {{name}}",
        "readyToConnect": "Готов к подключению к {{name}}",
        "selectServer": "Выберите сервер для подключения",
        "connectingHint": "Применение настроек TUN/proxy и маршрутизации. Это может занять несколько секунд.",
        "disconnectingHint": "Применение последовательности отключения и очистка маршрутов.",
        "country": "Страна",
        "ipAddress": "IP Адрес",
        "protocol": "Протокол",
        "connectionActive": "Соединение активно"
      },
      "settings": {
        "title": "Настройки",
        "subtitle": "Источники, маршрутизация и состояние подключения",
        "close": "Закрыть настройки",
        "navAria": "Разделы настроек",
        "tabs": {
          "sources": "Источники",
          "network": "Сеть",
          "diagnostics": "Диагностика"
        },
        "sources": {
          "subscriptions": "Подписки и импорт",
          "noSubscriptions": "Пока нет подписок. Добавьте одну ниже.",
          "addSubscription": "Добавить подписку",
          "namePlaceholder": "Название (например, Рабочий VPN)",
          "urlPlaceholder": "https://example.com/sub",
          "addAndFetch": "Добавить и загрузить",
          "adding": "Добавление...",
          "openPreview": "Открыть превью и импортировать мобильный список",
          "manualConfigs": "Ручные конфигурации",
          "manualPlaceholder": "Вставьте любой текст из буфера обмена. Все ссылки vless:// и trojan:// будут извлечены.",
          "manualHint": "Можно вставлять любой текст; ссылки извлекаются автоматически.",
          "saveManual": "Сохранить",
          "saving": "Сохранение...",
          "removeSubscription": "Удалить подписку",
          "enableSubscription": "Включить подписку",
          "disableSubscription": "Отключить подписку",
          "errors": {
            "nameRequired": "Укажите название",
            "urlRequired": "Укажите URL",
            "fetchFailed": "Не удалось загрузить подписку",
            "addFailed": "Не удалось добавить подписку",
            "loadFailed": "Не удалось загрузить конфигурации.",
            "saveManualFailed": "Не удалось сохранить ручные ссылки"
          }
        },
        "network": {
          "mode": "Режим сети",
          "proxyMode": "Режим прокси",
          "proxyDesc": "Системный прокси для обычных приложений.",
          "tunMode": "Режим TUN",
          "tunDesc": "Весь системный трафик. Могут потребоваться права администратора.",
          "disconnectHint": "Отключитесь перед сменой режима. Изменения применятся при следующем подключении.",
          "disconnectHintError": "Отключитесь перед изменением режима сети.",
          "tunUnavailable": "Режим TUN не поддерживается в данной операционной системе.",
          "tunUnsupportedDarwin": "Режим TUN в настоящее время поддерживается только в Windows и Linux через встроенное ядро Xray.",
          "tunElevated_win32": "Для работы режима TUN требуются права администратора. Подключитесь в режиме TUN и подтвердите запрос UAC (или запустите UltimaVLESS от имени администратора).",
          "tunElevated": "Запустите UltimaVLESS с правами root для использования режима TUN.",
          "tunDegradedLinux": "Маршрутизация TUN в Linux сейчас полагается на поведение автомаршрутизации Xray, а не на явное удаление маршрутов на уровне ОС.",
          "routingMode": "Режим маршрутизации: {{mode}}",
          "performance": "Настройки производительности",
          "performanceHint": "Изменения применяются при следующем подключении.",
          "performanceLocked": "Отключите VPN, чтобы изменить настройки производительности.",
          "muxEnabled": "TCP Mux",
          "muxEnabledHint": "Мультиплексирование TCP-соединений. Снижает задержки, но может уменьшить скорость загрузки.",
          "muxConcurrency": "Параллельность Mux",
          "muxConcurrencyHint": "Максимум подключений на одно Mux-соединение (1–128).",
          "xudpConcurrency": "Параллельность XUDP",
          "xudpConcurrencyHint": "Максимум параллельных UDP-подключений (1–1024).",
          "xudpProxyUDP443": "Политика UDP/443 (QUIC)",
          "xudpProxyUDP443Hint": "Как обрабатывать QUIC-трафик через прокси.",
          "udp443Reject": "Блокировать (откат на TCP)",
          "udp443Allow": "Разрешить через Mux",
          "udp443Skip": "Без Mux (нативный UDP)",
          "tcpFastOpen": "TCP Fast Open",
          "tcpFastOpenHint": "Отправка данных в SYN-пакете для снижения задержки.",
          "sniffingRouteOnly": "Sniffing только для маршрутизации",
          "sniffingRouteOnlyHint": "Использовать результаты sniffing только для роутинга, не менять адрес назначения.",
          "logLevel": "Уровень логирования",
          "logLevelHint": "Детализация логов Xray. Используйте 'debug' для диагностики.",
          "fingerprint": "TLS-отпечаток",
          "fingerprintHint": "Отпечаток браузера по умолчанию для антидетекта. Значение сервера имеет приоритет.",
          "blockAds": "Блокировка рекламы",
          "blockAdsHint": "Блокировать известные рекламные домены через geosite:category-ads-all.",
          "blockBittorrent": "Блокировка BitTorrent",
          "blockBittorrentHint": "Запрещать BitTorrent-трафик через прокси.",
          "domainStrategy": "Стратегия доменов",
          "domainStrategyHint": "Стратегия DNS-разрешения для правил маршрутизации.",
          "resetDefaults": "Сбросить по умолчанию"
        },
        "diagnostics": {
          "monitoring": "Мониторинг подключения",
          "autoSwitching": "Авто-переключение серверов",
          "autoSwitchingDesc": "Переключаться на другой сервер, если текущий выглядит заблокированным.",
          "currentServer": "Текущий сервер",
          "blockedServers": "Заблокированные серверы",
          "lastError": "Последняя ошибка",
          "xrayState": "Состояние Xray",
          "lastHealthCheck": "Последняя проверка",
          "healthState": "Состояние здоровья",
          "localProxy": "Доступность локального прокси",
          "healthFailure": "Ошибка здоровья",
          "xrayFailure": "Ошибка Xray",
          "recoveryInProgress": "Выполняется восстановление ({{count}})",
          "recoveryPaused": "Восстановление приостановлено после {{count}} попыток",
          "lastFatal": "Последняя критическая ошибка",
          "lastRecovery": "Последнее восстановление",
          "clear": "Очистить",
          "recentEvents": "Последние события",
          "serverShort": "Сервер {{id}}…",
          "eventTypes": {
            "connected": "Подключение",
            "disconnected": "Отключение",
            "error": "Ошибка",
            "blocked": "Заблокирован",
            "switching": "Переключение сервера"
          },
          "troubleshooting": "Решение проблем",
          "copyLogs": "Скопировать логи",
          "copied": "Скопировано!",
          "openFolder": "Открыть папку",
          "sanitizedHint": "Логи очищены от конфиденциальных личных данных"
        }
      }
    }
  }
};

const savedLanguage = localStorage.getItem('language') || 'ru';

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: savedLanguage,
    fallbackLng: "en",
    interpolation: {
      escapeValue: false // React already escapes values
    }
  });

// Hydrate from the main-process stored language (if available) and keep both
// persisted stores in sync so the tray, window title, and native notifications
// can use the same locale without the renderer being open.
if (typeof window !== 'undefined' && window.electronAPI?.getUiLanguage) {
  void window.electronAPI
    .getUiLanguage()
    .then((mainLang) => {
      if (mainLang && mainLang !== i18n.language) {
        void i18n.changeLanguage(mainLang);
      }
    })
    .catch(() => {
      /* ignore — renderer already has a sensible default */
    });
}

i18n.on('languageChanged', (lng) => {
  localStorage.setItem('language', lng);
  if (typeof window !== 'undefined' && window.electronAPI?.setUiLanguage && (lng === 'en' || lng === 'ru')) {
    void window.electronAPI.setUiLanguage(lng).catch(() => {
      /* non-fatal: main process will pick up the language on next launch */
    });
  }
});

export default i18n;
