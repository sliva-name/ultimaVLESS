import { logger } from '@/main/services/LoggerService';
import { runCommand } from './runCommand';
import { LinuxProxySnapshot } from './types';

const LINUX_TIMEOUT_MS = 8000;

const UNSUPPORTED_REASON =
  'Linux system proxy control currently requires a GNOME-compatible desktop with gsettings available.';

type Backend = 'gsettings' | 'unsupported';

export class LinuxProxyAdapter {
  private backend: Backend | null = null;

  async captureState(): Promise<LinuxProxySnapshot> {
    const backend = await this.getBackend();
    if (backend !== 'gsettings') {
      return {
        platform: 'linux',
        backend: 'unsupported',
        mode: 'none',
        httpHost: '',
        httpPort: 0,
        httpsHost: '',
        httpsPort: 0,
        socksHost: '',
        socksPort: 0,
      };
    }

    const [
      mode,
      httpHost,
      httpPort,
      httpsHost,
      httpsPort,
      socksHost,
      socksPort,
    ] = await Promise.all([
      this.runGsettings(['get', 'org.gnome.system.proxy', 'mode']),
      this.runGsettings(['get', 'org.gnome.system.proxy.http', 'host']),
      this.runGsettings(['get', 'org.gnome.system.proxy.http', 'port']),
      this.runGsettings(['get', 'org.gnome.system.proxy.https', 'host']),
      this.runGsettings(['get', 'org.gnome.system.proxy.https', 'port']),
      this.runGsettings(['get', 'org.gnome.system.proxy.socks', 'host']),
      this.runGsettings(['get', 'org.gnome.system.proxy.socks', 'port']),
    ]);
    return {
      platform: 'linux',
      backend,
      mode: parseGsettingsString(mode),
      httpHost: parseGsettingsString(httpHost),
      httpPort: parseGsettingsNumber(httpPort),
      httpsHost: parseGsettingsString(httpsHost),
      httpsPort: parseGsettingsNumber(httpsPort),
      socksHost: parseGsettingsString(socksHost),
      socksPort: parseGsettingsNumber(socksPort),
    };
  }

  async enable(httpPort: number, socksPort: number): Promise<void> {
    await this.ensureSupported();
    try {
      await this.runGsettings([
        'set',
        'org.gnome.system.proxy',
        'mode',
        'manual',
      ]);
      await this.runGsettings([
        'set',
        'org.gnome.system.proxy.http',
        'host',
        '127.0.0.1',
      ]);
      await this.runGsettings([
        'set',
        'org.gnome.system.proxy.http',
        'port',
        String(httpPort),
      ]);
      await this.runGsettings([
        'set',
        'org.gnome.system.proxy.https',
        'host',
        '127.0.0.1',
      ]);
      await this.runGsettings([
        'set',
        'org.gnome.system.proxy.https',
        'port',
        String(httpPort),
      ]);
      await this.runGsettings([
        'set',
        'org.gnome.system.proxy.socks',
        'host',
        '127.0.0.1',
      ]);
      await this.runGsettings([
        'set',
        'org.gnome.system.proxy.socks',
        'port',
        String(socksPort),
      ]);
      logger.info('SystemProxyService', 'Linux proxy enabled via gsettings', {
        httpPort,
        socksPort,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to enable Linux system proxy via gsettings: ${message}`,
      );
    }
  }

  async disable(): Promise<void> {
    await this.ensureSupported();
    try {
      await this.runGsettings([
        'set',
        'org.gnome.system.proxy',
        'mode',
        'none',
      ]);
      logger.info('SystemProxyService', 'Linux proxy disabled via gsettings');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to disable Linux system proxy via gsettings: ${message}`,
      );
    }
  }

  async restoreState(snapshot: LinuxProxySnapshot): Promise<void> {
    if (snapshot.backend === 'unsupported') {
      logger.warn(
        'SystemProxyService',
        'Skipping Linux proxy restore because original backend was unsupported',
      );
      return;
    }

    await this.runGsettings([
      'set',
      'org.gnome.system.proxy.http',
      'host',
      snapshot.httpHost,
    ]);
    await this.runGsettings([
      'set',
      'org.gnome.system.proxy.http',
      'port',
      String(snapshot.httpPort),
    ]);
    await this.runGsettings([
      'set',
      'org.gnome.system.proxy.https',
      'host',
      snapshot.httpsHost,
    ]);
    await this.runGsettings([
      'set',
      'org.gnome.system.proxy.https',
      'port',
      String(snapshot.httpsPort),
    ]);
    await this.runGsettings([
      'set',
      'org.gnome.system.proxy.socks',
      'host',
      snapshot.socksHost,
    ]);
    await this.runGsettings([
      'set',
      'org.gnome.system.proxy.socks',
      'port',
      String(snapshot.socksPort),
    ]);
    await this.runGsettings([
      'set',
      'org.gnome.system.proxy',
      'mode',
      snapshot.mode,
    ]);
  }

  private async ensureSupported(): Promise<void> {
    const backend = await this.getBackend();
    if (backend !== 'gsettings') {
      throw new Error(UNSUPPORTED_REASON);
    }
  }

  private async getBackend(): Promise<Backend> {
    if (this.backend) return this.backend;
    try {
      await runCommand(
        'gsettings',
        ['writable', 'org.gnome.system.proxy', 'mode'],
        LINUX_TIMEOUT_MS,
      );
      this.backend = 'gsettings';
    } catch (error) {
      logger.warn('SystemProxyService', 'Linux proxy backend is unsupported', {
        error: error instanceof Error ? error.message : String(error),
        desktop:
          process.env.XDG_CURRENT_DESKTOP ||
          process.env.DESKTOP_SESSION ||
          'unknown',
      });
      this.backend = 'unsupported';
    }
    return this.backend;
  }

  private runGsettings(args: string[]): Promise<string> {
    return runCommand('gsettings', args, LINUX_TIMEOUT_MS);
  }
}

function parseGsettingsString(raw: string): string {
  return raw.trim().replace(/^'/, '').replace(/'$/, '');
}

function parseGsettingsNumber(raw: string): number {
  const parsed = Number(raw.trim());
  return Number.isFinite(parsed) ? parsed : 0;
}
