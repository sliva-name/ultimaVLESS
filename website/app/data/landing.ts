const repository = 'https://github.com/sliva-name/ultimaVLESS';

export const siteLinks = {
  download: `${repository}/releases/latest`,
  releases: `${repository}/releases`,
  repository,
  issues: `${repository}/issues`,
  readme: `${repository}#readme`,
  routingDocs: `${repository}/blob/main/docs/routing-rules.md`,
  buildDocs: `${repository}#сборка-из-исходников`,
  license: `${repository}/blob/main/LICENSE`,
  api: {
    latestRelease: 'https://api.github.com/repos/sliva-name/ultimaVLESS/releases/latest',
    repository: 'https://api.github.com/repos/sliva-name/ultimaVLESS',
  },
};

export const seo = {
  title: 'UltimaVLESS - бесплатный VLESS VPN-клиент с конфигами внутри',
  description:
    'Скачайте UltimaVLESS: бесплатный Xray/VLESS VPN-клиент для Windows, macOS, Linux и Android с импортом готовых бесплатных конфигов прямо в приложении.',
  keywords: [
    'UltimaVLESS',
    'VLESS VPN клиент',
    'Xray VPN',
    'бесплатные VLESS конфиги',
    'VPN для Windows',
    'VPN для Android',
    'Reality Vision VPN',
    'TUN VPN клиент',
  ],
};

export type PlatformId = 'windows' | 'macos' | 'linux' | 'android';

export interface PlatformFile {
  label: string;
  hint: string;
  /** Matches the asset name in a GitHub release, whatever the version. */
  pattern: RegExp;
}

export interface Platform {
  id: PlatformId;
  name: string;
  requirement: string;
  /** The first file is the one to recommend. */
  files: PlatformFile[];
  note?: string;
}

export const platforms: Platform[] = [
  {
    id: 'windows',
    name: 'Windows',
    requirement: 'Windows 10 и 11, x64',
    files: [
      {
        label: 'Установщик',
        hint: 'Обновляется сам',
        pattern: /^UltimaVLESS-Setup-[\d.]+\.exe$/,
      },
      {
        label: 'Portable',
        hint: 'Без установки, обновлять вручную',
        pattern: /^UltimaVLESS-Portable-[\d.]+\.exe$/,
      },
    ],
  },
  {
    id: 'macos',
    name: 'macOS',
    requirement: 'Режим прокси, TUN недоступен',
    files: [
      {
        label: 'Apple Silicon',
        hint: 'M1 и новее',
        pattern: /^UltimaVLESS-[\d.]+-arm64\.dmg$/,
      },
      {
        label: 'Intel',
        hint: 'Mac на Intel',
        pattern: /^UltimaVLESS-[\d.]+\.dmg$/,
      },
    ],
  },
  {
    id: 'linux',
    name: 'Linux',
    requirement: 'x64, для TUN нужен pkexec',
    files: [
      {
        label: 'AppImage',
        hint: 'Любой дистрибутив',
        pattern: /^UltimaVLESS-[\d.]+\.AppImage$/,
      },
      {
        label: 'DEB',
        hint: 'Debian, Ubuntu, Mint',
        pattern: /^ultima-vless-client_[\d.]+_amd64\.deb$/,
      },
    ],
  },
  {
    id: 'android',
    name: 'Android',
    requirement: 'Android 7.0 и новее',
    files: [
      {
        label: 'arm64-v8a',
        hint: 'Подходит большинству телефонов',
        pattern: /^UltimaVLESS-Android-[\d.]+-arm64-v8a\.apk$/,
      },
      {
        label: 'universal',
        hint: 'Если не уверены — работает везде',
        pattern: /^UltimaVLESS-Android-[\d.]+-universal\.apk$/,
      },
    ],
    note: 'Есть и сборки armeabi-v7a и x86_64 — в релизе.',
  },
];

export const heroHighlights = [
  'Бесплатно и с открытым кодом',
  'Без регистрации',
  'Ядро Xray-core',
];

export const startSteps = [
  {
    title: 'Скачайте клиент',
    text: 'Установщик или portable для Windows, сборки для macOS и Linux, APK для Android — всё в последнем релизе на GitHub.',
  },
  {
    title: 'Добавьте серверы',
    text: 'Вставьте подписку провайдера или ссылки vless://, trojan://, ss://, hy2://. Своих серверов нет — импортируйте бесплатный «Мобильный белый список» в разделе «Подписки» (на Android — через «Настройки»).',
  },
  {
    title: 'Подключитесь',
    text: 'Выберите сервер с хорошей задержкой и нажмите «Подключить». Клиент проверит, что через туннель действительно идёт интернет.',
  },
];

export const features = [
  {
    id: 'latency',
    title: 'Честная проверка серверов',
    text: 'Для каждого сервера запускается временный Xray, и через него уходит настоящий запрос. Сервер, который отвечает, но не пропускает трафик, не выглядит рабочим.',
  },
  {
    id: 'modes',
    title: 'Прокси или весь трафик',
    text: 'Системный прокси без прав администратора или TUN для всех программ. На Android — системный VPN и режим «Только прокси».',
  },
  {
    id: 'routing',
    title: 'Только нужное через VPN',
    text: 'Весь трафик с исключениями, только выбранные сайты или только выбранные приложения. Списки geosite и geoip, блокировка рекламы и BitTorrent.',
  },
  {
    id: 'failover',
    title: 'Автопереключение',
    text: 'Если сервер перестал пропускать трафик, клиент сам перейдёт на другой и восстановит соединение.',
  },
  {
    id: 'updates',
    title: 'Обновляется сам',
    text: 'Новые версии приходят с GitHub прямо в приложении — и на компьютере, и на Android.',
  },
  {
    id: 'diagnostics',
    title: 'Диагностика и логи',
    text: 'Состояние ядра, проверка туннеля, другие VPN и программы обхода DPI, которые мешают TUN. Логи копируются без личных данных.',
  },
  {
    id: 'protocols',
    title: 'Все популярные протоколы Xray',
    text: 'Ссылки и подписки по HTTPS — текстом, Base64 или JSON-конфигами Xray. WireGuard и VMess подключаются через JSON-подписки.',
  },
];

export const protocols = [
  'VLESS',
  'REALITY',
  'Vision',
  'XHTTP',
  'Trojan',
  'Shadowsocks',
  'Hysteria 2',
  'WireGuard',
  'VMess',
];

export interface Screen {
  id: string;
  label: string;
  images: { src: string; alt: string; width: number; height: number }[];
}

const desktopShot = (src: string, alt: string) => ({ src, alt, width: 1800, height: 1400 });
const phoneShot = (src: string, alt: string) => ({ src, alt, width: 824, height: 1830 });

export const screens: Screen[] = [
  {
    id: 'routing',
    label: 'Маршруты',
    images: [
      desktopShot(
        'desktop-routing.png',
        'Раздел «Маршруты»: режим маршрутизации, сайты и приложения в обход VPN',
      ),
    ],
  },
  {
    id: 'subscriptions',
    label: 'Подписки',
    images: [
      desktopShot(
        'desktop-subscriptions.png',
        'Раздел «Подписки и импорт»: подписки, ручные ссылки и мобильный белый список',
      ),
    ],
  },
  {
    id: 'settings',
    label: 'Режим и сеть',
    images: [
      desktopShot(
        'desktop-settings.png',
        'Настройки «Режим и сеть»: прокси или TUN, адаптер для TUN, способ проверки задержки',
      ),
    ],
  },
  {
    id: 'core',
    label: 'Ядро Xray',
    images: [
      desktopShot('desktop-core.png', 'Настройки «Ядро Xray»: Mux, UDP и QUIC, MTU туннеля'),
    ],
  },
  {
    id: 'diagnostics',
    label: 'Диагностика',
    images: [
      desktopShot(
        'desktop-diagnostics.png',
        'Раздел «Диагностика»: состояние ядра, автопереключение и события',
      ),
    ],
  },
  {
    id: 'android',
    label: 'Android',
    images: [
      phoneShot('android-home.png', 'Android: главный экран, подключено'),
      phoneShot('android-servers.png', 'Android: список серверов с задержкой'),
      phoneShot('android-settings.png', 'Android: настройки'),
    ],
  },
];

export const faq = [
  {
    question: 'Нужно ли покупать подписку перед запуском?',
    answer:
      'Нет. Для старта можно импортировать бесплатный «Мобильный белый список» в разделе «Подписки» (на Android — через «Настройки»). Свои подписки и ссылки тоже поддерживаются.',
  },
  {
    question: 'Какие протоколы поддерживаются?',
    answer:
      'VLESS (в том числе REALITY, Vision и XHTTP), Trojan, Shadowsocks и Hysteria 2 — ссылками и подписками. WireGuard и VMess — через JSON-подписки Xray. Не поддерживаются TUIC, ссылки vmess:// и зашифрованные ссылки Happ.',
  },
  {
    question: 'Чем отличается Proxy от TUN?',
    answer:
      'Proxy включает системный прокси и чаще всего не требует прав администратора. TUN направляет весь системный трафик через виртуальный адаптер. На macOS TUN недоступен, на Android вместо него работает системный VPN.',
  },
  {
    question: 'Есть ли версия для Android?',
    answer:
      'Да, для Android 7.0 и новее. Скачайте APK из последнего релиза на GitHub: arm64-v8a подходит большинству телефонов, universal — если не уверены. Вместо TUN там работает системный VPN, есть и режим «Только прокси». Обновления приходят прямо в приложении.',
  },
  {
    question: 'Windows или macOS не дают запустить программу',
    answer:
      'Сборки не подписаны платными сертификатами. Windows может показать «Windows защитил ваш компьютер» — нажмите «Подробнее», затем «Выполнить в любом случае». macOS может не открыть программу или назвать её повреждённой — разрешите запуск в «Системные настройки → Конфиденциальность и безопасность» или выполните в терминале xattr -dr com.apple.quarantine /Applications/UltimaVLESS.app.',
  },
  {
    question: 'Это правда бесплатно?',
    answer:
      'Да. Клиент бесплатный, без рекламы и регистрации, исходный код открыт под лицензией MIT. Серверы в клиент не входят: используйте подписку своего провайдера или бесплатный публичный список.',
  },
];
