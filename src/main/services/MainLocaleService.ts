import { EventEmitter } from 'events';
import { configService, UiLanguage } from './ConfigService';

export type MainTranslationKey =
  | 'tray.show'
  | 'tray.hide'
  | 'tray.quit'
  | 'tray.connect'
  | 'tray.disconnect'
  | 'tray.connected'
  | 'tray.disconnected'
  | 'tray.connecting'
  | 'tray.connectedTo'
  | 'tray.server'
  | 'tray.ping'
  | 'notify.connected.title'
  | 'notify.connected.body'
  | 'notify.disconnected.title'
  | 'notify.disconnected.body'
  | 'notify.error.title'
  | 'notify.switching.title'
  | 'notify.switching.body'
  | 'notify.updateAvailable.title'
  | 'notify.updateAvailable.body'
  | 'notify.updateReady.title'
  | 'notify.updateReady.body';

const STRINGS: Record<UiLanguage, Record<MainTranslationKey, string>> = {
  en: {
    'tray.show': 'Show',
    'tray.hide': 'Hide',
    'tray.quit': 'Quit',
    'tray.connect': 'Connect',
    'tray.disconnect': 'Disconnect',
    'tray.connected': 'Connected',
    'tray.disconnected': 'Disconnected',
    'tray.connecting': 'Connecting…',
    'tray.connectedTo': 'Connected to {name}',
    'tray.server': 'Server',
    'tray.ping': 'Ping: {ping} ms',
    'notify.connected.title': 'UltimaVLESS — Connected',
    'notify.connected.body': 'Tunnel to {name} is up',
    'notify.disconnected.title': 'UltimaVLESS — Disconnected',
    'notify.disconnected.body': 'VPN tunnel was closed',
    'notify.error.title': 'UltimaVLESS — Connection error',
    'notify.switching.title': 'UltimaVLESS — Switching server',
    'notify.switching.body':
      'Current server looks blocked, trying another one…',
    'notify.updateAvailable.title': 'UltimaVLESS — Update available',
    'notify.updateAvailable.body':
      'Version {version} is being downloaded in the background.',
    'notify.updateReady.title': 'UltimaVLESS — Update ready',
    'notify.updateReady.body':
      'Version {version} will install on next restart.',
  },
  ru: {
    'tray.show': 'Показать',
    'tray.hide': 'Скрыть',
    'tray.quit': 'Выход',
    'tray.connect': 'Подключить',
    'tray.disconnect': 'Отключить',
    'tray.connected': 'Подключено',
    'tray.disconnected': 'Отключено',
    'tray.connecting': 'Подключение…',
    'tray.connectedTo': 'Подключено к {name}',
    'tray.server': 'Сервер',
    'tray.ping': 'Пинг: {ping} мс',
    'notify.connected.title': 'UltimaVLESS — подключено',
    'notify.connected.body': 'Туннель до {name} поднят',
    'notify.disconnected.title': 'UltimaVLESS — отключено',
    'notify.disconnected.body': 'VPN-туннель закрыт',
    'notify.error.title': 'UltimaVLESS — ошибка подключения',
    'notify.switching.title': 'UltimaVLESS — смена сервера',
    'notify.switching.body':
      'Текущий сервер выглядит заблокированным, пробуем другой…',
    'notify.updateAvailable.title': 'UltimaVLESS — доступно обновление',
    'notify.updateAvailable.body': 'Версия {version} загружается в фоне.',
    'notify.updateReady.title': 'UltimaVLESS — обновление готово',
    'notify.updateReady.body':
      'Версия {version} установится при следующем запуске.',
  },
  zh: {
    'tray.show': '显示',
    'tray.hide': '隐藏',
    'tray.quit': '退出',
    'tray.connect': '连接',
    'tray.disconnect': '断开连接',
    'tray.connected': '已连接',
    'tray.disconnected': '已断开连接',
    'tray.connecting': '正在连接…',
    'tray.connectedTo': '已连接到 {name}',
    'tray.server': '服务器',
    'tray.ping': '延迟：{ping} 毫秒',
    'notify.connected.title': 'UltimaVLESS — 已连接',
    'notify.connected.body': '已与 {name} 建立隧道连接',
    'notify.disconnected.title': 'UltimaVLESS — 已断开连接',
    'notify.disconnected.body': 'VPN 隧道已关闭',
    'notify.error.title': 'UltimaVLESS — 连接错误',
    'notify.switching.title': 'UltimaVLESS — 正在切换服务器',
    'notify.switching.body': '当前服务器似乎已被屏蔽，正在尝试其他服务器…',
    'notify.updateAvailable.title': 'UltimaVLESS — 有可用更新',
    'notify.updateAvailable.body': '正在后台下载版本 {version}。',
    'notify.updateReady.title': 'UltimaVLESS — 更新已就绪',
    'notify.updateReady.body': '版本 {version} 将在下次重启时安装。',
  },
  fa: {
    'tray.show': 'نمایش',
    'tray.hide': 'پنهان کردن',
    'tray.quit': 'خروج',
    'tray.connect': 'اتصال',
    'tray.disconnect': 'قطع اتصال',
    'tray.connected': 'متصل',
    'tray.disconnected': 'قطع‌شده',
    'tray.connecting': 'در حال اتصال…',
    'tray.connectedTo': 'متصل به {name}',
    'tray.server': 'سرور',
    'tray.ping': 'پینگ: {ping} میلی‌ثانیه',
    'notify.connected.title': 'UltimaVLESS — متصل شد',
    'notify.connected.body': 'تونل به {name} برقرار شد',
    'notify.disconnected.title': 'UltimaVLESS — قطع شد',
    'notify.disconnected.body': 'تونل VPN بسته شد',
    'notify.error.title': 'UltimaVLESS — خطای اتصال',
    'notify.switching.title': 'UltimaVLESS — در حال تغییر سرور',
    'notify.switching.body': 'به نظر می‌رسد سرور فعلی مسدود شده است؛ سرور دیگری را امتحان می‌کنیم…',
    'notify.updateAvailable.title': 'UltimaVLESS — به‌روزرسانی موجود است',
    'notify.updateAvailable.body': 'نسخه {version} در پس‌زمینه در حال دانلود است.',
    'notify.updateReady.title': 'UltimaVLESS — به‌روزرسانی آماده است',
    'notify.updateReady.body': 'نسخه {version} در راه‌اندازی بعدی نصب خواهد شد.',
  },
  es: {
    'tray.show': 'Mostrar',
    'tray.hide': 'Ocultar',
    'tray.quit': 'Salir',
    'tray.connect': 'Conectar',
    'tray.disconnect': 'Desconectar',
    'tray.connected': 'Conectado',
    'tray.disconnected': 'Desconectado',
    'tray.connecting': 'Conectando…',
    'tray.connectedTo': 'Conectado a {name}',
    'tray.server': 'Servidor',
    'tray.ping': 'Ping: {ping} ms',
    'notify.connected.title': 'UltimaVLESS — Conectado',
    'notify.connected.body': 'El túnel a {name} está activo',
    'notify.disconnected.title': 'UltimaVLESS — Desconectado',
    'notify.disconnected.body': 'El túnel VPN se ha cerrado',
    'notify.error.title': 'UltimaVLESS — Error de conexión',
    'notify.switching.title': 'UltimaVLESS — Cambiando de servidor',
    'notify.switching.body': 'El servidor actual parece estar bloqueado; probando otro…',
    'notify.updateAvailable.title': 'UltimaVLESS — Actualización disponible',
    'notify.updateAvailable.body': 'La versión {version} se está descargando en segundo plano.',
    'notify.updateReady.title': 'UltimaVLESS — Actualización lista',
    'notify.updateReady.body': 'La versión {version} se instalará en el próximo reinicio.',
  },
  tr: {
    'tray.show': 'Göster',
    'tray.hide': 'Gizle',
    'tray.quit': 'Çıkış',
    'tray.connect': 'Bağlan',
    'tray.disconnect': 'Bağlantıyı kes',
    'tray.connected': 'Bağlandı',
    'tray.disconnected': 'Bağlantı kesildi',
    'tray.connecting': 'Bağlanıyor…',
    'tray.connectedTo': '{name} sunucusuna bağlandı',
    'tray.server': 'Sunucu',
    'tray.ping': 'Ping: {ping} ms',
    'notify.connected.title': 'UltimaVLESS — Bağlandı',
    'notify.connected.body': '{name} sunucusuna tünel bağlantısı kuruldu',
    'notify.disconnected.title': 'UltimaVLESS — Bağlantı kesildi',
    'notify.disconnected.body': 'VPN tüneli kapatıldı',
    'notify.error.title': 'UltimaVLESS — Bağlantı hatası',
    'notify.switching.title': 'UltimaVLESS — Sunucu değiştiriliyor',
    'notify.switching.body': 'Mevcut sunucu engellenmiş gibi görünüyor, başka bir sunucu deneniyor…',
    'notify.updateAvailable.title': 'UltimaVLESS — Güncelleme mevcut',
    'notify.updateAvailable.body': '{version} sürümü arka planda indiriliyor.',
    'notify.updateReady.title': 'UltimaVLESS — Güncelleme hazır',
    'notify.updateReady.body': '{version} sürümü bir sonraki yeniden başlatmada yüklenecek.',
  },
};

function format(
  template: string,
  params: Record<string, string | number | null | undefined>,
): string {
  return template.replace(/{(\w+)}/g, (_, key: string) => {
    const value = params[key];
    return value === null || value === undefined ? '' : String(value);
  });
}

class MainLocaleService extends EventEmitter {
  private language: UiLanguage;

  constructor() {
    super();
    this.language = configService.getUiLanguage();
  }

  public getLanguage(): UiLanguage {
    return this.language;
  }

  public setLanguage(language: UiLanguage): void {
    if (this.language === language) return;
    this.language = language;
    configService.setUiLanguage(language);
    this.emit('language-changed', language);
  }

  public t(
    key: MainTranslationKey,
    params: Record<string, string | number | null | undefined> = {},
  ): string {
    const table = STRINGS[this.language] ?? STRINGS.en;
    const template = table[key] ?? STRINGS.en[key] ?? key;
    return format(template, params);
  }
}

export const mainLocaleService = new MainLocaleService();
