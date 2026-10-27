import type { i18n as I18n } from 'i18next';

/**
 * Desktop wording that does not fit a phone: TUN is "VPN" (the system's own
 * term), apps are packages rather than executables, and logs are shared
 * rather than opened in a folder. Merged over the desktop resources.
 */
const OVERRIDES = {
  ru: {
    settings: {
      subtitle: 'Источники серверов, режим сети и диагностика.',
      network: {
        proxyMode: 'Только прокси',
        proxyDesc:
          'Без VPN: локальные SOCKS5 127.0.0.1:10808 и HTTP 127.0.0.1:10809 для приложений, где прокси указан вручную.',
        tunMode: 'VPN',
        tunDesc:
          'Весь трафик телефона через VPN. При первом подключении Android попросит разрешение.',
        modeReconnectHint:
          'При выборе другого режима подключение к тому же серверу перезапустится в нём.',
        remoteDnsHint:
          'Резолверы Xray. В режиме VPN DNS-запросы приложений перехватываются и идут через прокси.',
        tunMtu: 'MTU VPN',
        tunMtuHint:
          'Если в режиме «Только прокси» сайты открываются, а через VPN на медленном сервере — нет, уменьшите значение. 1400 по умолчанию; 1280 — безопаснее на плохой линии.',
        tunDnsQueryStrategy: 'DNS в VPN',
        tunDnsQueryStrategyHint:
          'Только для VPN: прокси всегда ходит по IPv4. «Только IPv4» — по умолчанию, страницы открываются быстрее. «IPv4 и IPv6» или «Как в системе» — если нужны сайты, доступные только по IPv6.',
        tunDnsUseIPv4Desc: 'Рекомендуется. Страницы открываются быстрее',
        routingModeAppsDesc:
          'Выбранные приложения — через VPN, остальные напрямую.',
        routingProxyAppsHint:
          'Все соединения этих приложений идут через VPN, кроме локальной сети и исключений.',
        routingDirectAppsHint:
          'Эти приложения всегда идут через обычное подключение, мимо VPN.',
        routingAppsPlaceholder: 'Поиск приложения или имя пакета',
        routingAppsInvalid: 'Не похоже на имя пакета: {{entries}}',
        routingAppsShowList: 'Показать установленные приложения',
        routingAppsLoading: 'Загрузка списка приложений…',
        routingAppsNoMatches:
          'Совпадений нет. Enter добавит имя пакета как есть.',
        routingAppsNoRunning:
          'Приложения не найдены — введите имя пакета, например org.telegram.messenger.',
        routingAppsSystemGroup: 'Системные',
        routingAppsCaseNote:
          'Приложения определяются по имени пакета (например, org.telegram.messenger) — выберите их из списка установленных.',
        routingAppsProxyNote:
          'В режиме «Только прокси» правила для приложений не действуют: Android не сообщает, какое приложение подключилось к прокси. Чтобы выбрать приложения, используйте режим VPN.',
      },
      diagnostics: {
        openFolder: 'Поделиться логами',
      },
    },
    mobile: {
      tabs: {
        home: 'Главная',
        servers: 'Серверы',
        settings: 'Настройки',
      },
      selectedServer: 'Выбранный сервер',
      noServerSelected: 'Сервер не выбран',
      chooseServer: 'Выбрать сервер',
      modeVpn: 'VPN',
      modeProxy: 'Прокси',
      connect: 'Подключить',
      disconnect: 'Отключить',
      idle: 'Не подключено',
      proxyEndpoints: 'SOCKS5 127.0.0.1:10808 · HTTP 127.0.0.1:10809',
      startFailed: 'Не удалось запустить приложение',
    },
  },
  en: {
    settings: {
      subtitle: 'Server sources, network mode and diagnostics.',
      network: {
        proxyMode: 'Proxy only',
        proxyDesc:
          'No VPN: local SOCKS5 127.0.0.1:10808 and HTTP 127.0.0.1:10809 for apps you point at them.',
        tunMode: 'VPN',
        tunDesc:
          'All phone traffic through the VPN. Android asks for permission on the first connect.',
        remoteDnsHint:
          "Resolvers used by Xray. In VPN mode apps' DNS queries are intercepted and sent through the proxy.",
        tunMtu: 'VPN MTU',
        tunMtuHint:
          'If sites open in proxy-only mode but not through the VPN on a slow server, lower this. Default 1400; 1280 is safer on a bad line.',
        tunDnsQueryStrategy: 'VPN DNS query strategy',
        tunDnsQueryStrategyHint:
          'VPN only — proxy always uses IPv4. IPv4-only is the default so pages open faster. Pick IPv4 and IPv6 or Follow the OS only if you need IPv6-only sites.',
        tunDnsUseIPv4Desc: 'Recommended. Pages open faster',
        routingModeAppsDesc:
          'The chosen apps go through the VPN, everything else direct.',
        routingProxyAppsHint:
          'All connections of these apps go through the VPN, except the local network and excluded sites.',
        routingDirectAppsHint:
          'These apps always use your normal connection, past the VPN.',
        routingAppsPlaceholder: 'Search apps or type a package name',
        routingAppsInvalid: 'Not a package name: {{entries}}',
        routingAppsShowList: 'Show installed apps',
        routingAppsLoading: 'Loading installed apps…',
        routingAppsNoMatches:
          'No installed app matches. Press Enter to add the package name as typed.',
        routingAppsNoRunning:
          'No apps found — type a package name such as org.telegram.messenger.',
        routingAppsSystemGroup: 'System',
        routingAppsCaseNote:
          'Apps are matched by package name (e.g. org.telegram.messenger) — pick them from the installed apps.',
        routingAppsProxyNote:
          'App rules do not apply in proxy-only mode: Android does not tell which app connected to the proxy. Use VPN mode to choose apps.',
      },
      diagnostics: {
        openFolder: 'Share logs',
      },
    },
    mobile: {
      tabs: {
        home: 'Home',
        servers: 'Servers',
        settings: 'Settings',
      },
      selectedServer: 'Selected server',
      noServerSelected: 'No server selected',
      chooseServer: 'Choose server',
      modeVpn: 'VPN',
      modeProxy: 'Proxy',
      connect: 'Connect',
      disconnect: 'Disconnect',
      idle: 'Not connected',
      proxyEndpoints: 'SOCKS5 127.0.0.1:10808 · HTTP 127.0.0.1:10809',
      startFailed: 'The app failed to start',
    },
  },
};

export function applyMobileTranslations(i18n: I18n): void {
  for (const [language, resources] of Object.entries(OVERRIDES)) {
    i18n.addResourceBundle(language, 'translation', resources, true, true);
  }
}
