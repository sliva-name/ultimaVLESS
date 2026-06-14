export const siteLinks = {
  download: 'https://github.com/sliva-name/ultimaVLESS/releases/latest',
  repository: 'https://github.com/sliva-name/ultimaVLESS',
};

export const seo = {
  title: 'UltimaVLESS - бесплатный VLESS VPN-клиент с конфигами внутри',
  description:
    'Скачайте UltimaVLESS: бесплатный Xray/VLESS VPN-клиент для Windows, macOS и Linux с импортом готовых бесплатных конфигов прямо в приложении.',
  keywords: [
    'UltimaVLESS',
    'VLESS VPN клиент',
    'Xray VPN',
    'бесплатные VLESS конфиги',
    'VPN для Windows',
    'Reality Vision VPN',
    'TUN VPN клиент',
  ],
};

export const features = [
  {
    label: 'Бесплатные конфиги внутри',
    title: 'Импорт готового списка в один клик',
    text: 'В разделе «Источники» есть кнопка импорта Mobile White List. Не нужно вручную искать стартовую подписку, чтобы проверить клиент.',
  },
  {
    label: 'Xray Core',
    title: 'VLESS Reality/Vision и другие протоколы',
    text: 'Поддерживаются VLESS, Trojan, Shadowsocks и готовые JSON-конфиги VMess/Xray. Ссылки можно вставлять пачкой.',
  },
  {
    label: 'Proxy / TUN',
    title: 'Два режима подключения',
    text: 'Прокси подходит для обычного использования без прав администратора, а TUN может направлять через VPN весь системный трафик.',
  },
  {
    label: 'Надежность',
    title: 'Пинг и автопереключение серверов',
    text: 'Клиент проверяет задержку, показывает состояние подключения и может переключиться на другой сервер при проблемах.',
  },
  {
    label: 'Контроль',
    title: 'Статистика, диагностика и логи',
    text: 'В приложении видны трафик за сессию, ошибки подключения и очищенные диагностические логи для быстрой поддержки.',
  },
  {
    label: 'Обновления',
    title: 'Автообновление через GitHub',
    text: 'UltimaVLESS проверяет новые релизы и помогает установить актуальную версию без ручной проверки репозитория.',
  },
];

export const quickStartSteps = [
  'Скачайте установщик или portable-версию с GitHub Releases.',
  'Откройте «Настройки» -> «Источники» и импортируйте бесплатный Mobile White List.',
  'Выберите сервер, проверьте пинг и нажмите «Подключиться».',
];

export const downloads = [
  {
    os: 'Windows',
    title: 'Setup или Portable',
    text: 'Основная платформа клиента. Доступны установщик и версия без установки.',
  },
  {
    os: 'macOS',
    title: 'DMG / ZIP',
    text: 'Подходит для режима системного прокси. Возможности TUN могут отличаться.',
  },
  {
    os: 'Linux',
    title: 'AppImage / DEB',
    text: 'Готовые сборки для быстрого запуска на популярных дистрибутивах.',
  },
];

export const faq = [
  {
    question: 'Нужно ли покупать подписку перед запуском?',
    answer:
      'Нет. Для старта можно импортировать встроенный бесплатный Mobile White List в настройках клиента. Свои подписки и ссылки тоже поддерживаются.',
  },
  {
    question: 'Какие протоколы поддерживаются?',
    answer:
      'VLESS, включая Reality и Vision, Trojan, Shadowsocks, а также VMess через JSON-подписки Xray.',
  },
  {
    question: 'Чем отличается Proxy от TUN?',
    answer:
      'Proxy включает системный прокси и чаще всего не требует прав администратора. TUN направляет весь системный трафик через виртуальный адаптер.',
  },
];
