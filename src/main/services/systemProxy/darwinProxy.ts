import { logger } from '@/main/services/LoggerService';
import { runCommand } from './runCommand';
import { MacosProxySnapshot, MacosServiceProxySnapshot } from './types';

const MACOS_TIMEOUT_MS = 15000;
const NETWORKSETUP = '/usr/sbin/networksetup';

type MacosProxyKind = 'web' | 'secure' | 'socks';

export class DarwinProxyAdapter {
  async captureState(): Promise<MacosProxySnapshot> {
    const services = await this.listNetworkServices();
    const snapshots = await Promise.all(
      services.map(async (service) => {
        const [web, secure, socks] = await Promise.all([
          this.getProxyDetails(service, 'web'),
          this.getProxyDetails(service, 'secure'),
          this.getProxyDetails(service, 'socks'),
        ]);
        return {
          service,
          webEnabled: web.enabled,
          webHost: web.host,
          webPort: web.port,
          secureEnabled: secure.enabled,
          secureHost: secure.host,
          securePort: secure.port,
          socksEnabled: socks.enabled,
          socksHost: socks.host,
          socksPort: socks.port,
        } satisfies MacosServiceProxySnapshot;
      }),
    );
    return { platform: 'darwin', services: snapshots };
  }

  async enable(httpPort: number, socksPort: number): Promise<void> {
    const services = await this.listNetworkServices();
    if (services.length === 0) {
      throw new Error(
        'No macOS network services found for system proxy configuration.',
      );
    }

    for (const service of services) {
      await this.run([
        NETWORKSETUP,
        '-setwebproxy',
        service,
        '127.0.0.1',
        String(httpPort),
      ]);
      await this.run([
        NETWORKSETUP,
        '-setsecurewebproxy',
        service,
        '127.0.0.1',
        String(httpPort),
      ]);
      await this.run([
        NETWORKSETUP,
        '-setsocksfirewallproxy',
        service,
        '127.0.0.1',
        String(socksPort),
      ]);
      await this.run([NETWORKSETUP, '-setwebproxystate', service, 'on']);
      await this.run([NETWORKSETUP, '-setsecurewebproxystate', service, 'on']);
      await this.run([
        NETWORKSETUP,
        '-setsocksfirewallproxystate',
        service,
        'on',
      ]);
    }

    logger.info('SystemProxyService', 'macOS system proxy enabled', {
      servicesCount: services.length,
      httpPort,
      socksPort,
    });
  }

  async disable(): Promise<void> {
    const services = await this.listNetworkServices();
    if (services.length === 0) {
      logger.warn(
        'SystemProxyService',
        'No macOS network services found while disabling proxy',
      );
      return;
    }

    for (const service of services) {
      await this.run([NETWORKSETUP, '-setwebproxystate', service, 'off']);
      await this.run([NETWORKSETUP, '-setsecurewebproxystate', service, 'off']);
      await this.run([
        NETWORKSETUP,
        '-setsocksfirewallproxystate',
        service,
        'off',
      ]);
    }

    logger.info('SystemProxyService', 'macOS system proxy disabled', {
      servicesCount: services.length,
    });
  }

  async restoreState(snapshot: MacosProxySnapshot): Promise<void> {
    for (const service of snapshot.services) {
      await this.restoreKind(
        service.service,
        'web',
        service.webHost,
        service.webPort,
        service.webEnabled,
      );
      await this.restoreKind(
        service.service,
        'secure',
        service.secureHost,
        service.securePort,
        service.secureEnabled,
      );
      await this.restoreKind(
        service.service,
        'socks',
        service.socksHost,
        service.socksPort,
        service.socksEnabled,
      );
    }
  }

  private async listNetworkServices(): Promise<string[]> {
    const output = await this.run([NETWORKSETUP, '-listallnetworkservices']);
    return output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .filter(
        (line) =>
          line !==
          'An asterisk (*) denotes that a network service is disabled.',
      )
      .map((line) => line.replace(/^\*\s*/, ''));
  }

  private async getProxyDetails(
    service: string,
    kind: MacosProxyKind,
  ): Promise<{ enabled: boolean; host: string | null; port: number | null }> {
    const flag =
      kind === 'web'
        ? '-getwebproxy'
        : kind === 'secure'
          ? '-getsecurewebproxy'
          : '-getsocksfirewallproxy';
    const output = await this.run([NETWORKSETUP, flag, service]);
    return parseProxyDetails(output);
  }

  private async restoreKind(
    service: string,
    kind: MacosProxyKind,
    host: string | null,
    port: number | null,
    enabled: boolean,
  ): Promise<void> {
    const setFlag =
      kind === 'web'
        ? '-setwebproxy'
        : kind === 'secure'
          ? '-setsecurewebproxy'
          : '-setsocksfirewallproxy';
    const stateFlag =
      kind === 'web'
        ? '-setwebproxystate'
        : kind === 'secure'
          ? '-setsecurewebproxystate'
          : '-setsocksfirewallproxystate';

    if (host && port != null) {
      await this.run([NETWORKSETUP, setFlag, service, host, String(port)]);
    }
    await this.run([NETWORKSETUP, stateFlag, service, enabled ? 'on' : 'off']);
  }

  private run(argv: string[]): Promise<string> {
    const [command, ...args] = argv;
    return runCommand(command, args, MACOS_TIMEOUT_MS);
  }
}

function parseProxyDetails(output: string): {
  enabled: boolean;
  host: string | null;
  port: number | null;
} {
  const enabled = /^\s*Enabled:\s+Yes\s*$/im.test(output);
  const serverMatch = /^\s*Server:\s+(.+)\s*$/im.exec(output);
  const portMatch = /^\s*Port:\s+(\d+)\s*$/im.exec(output);
  return {
    enabled,
    host: serverMatch ? serverMatch[1].trim() : null,
    port: portMatch ? Number(portMatch[1]) : null,
  };
}
