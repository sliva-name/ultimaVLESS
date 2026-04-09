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
        "connected": "Connected"
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
          "saving": "Saving..."
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
          "routingMode": "Routing mode: {{mode}}"
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
        "connected": "Подключено"
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
          "saving": "Сохранение..."
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
          "routingMode": "Режим маршрутизации: {{mode}}"
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
    lng: savedLanguage, // default language
    fallbackLng: "en",
    interpolation: {
      escapeValue: false // React already escapes values
    }
  });

i18n.on('languageChanged', (lng) => {
  localStorage.setItem('language', lng);
});

export default i18n;
