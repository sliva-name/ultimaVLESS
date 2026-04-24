import { spawn } from 'child_process';
import { DefaultRouteInfo, UNIX_COMMAND_TIMEOUT } from './constants';

/**
 * Unix-specific route discovery helpers. Each function is a free function
 * so the TunRouteService keeps its exposed private methods intact (tests rely
 * on spying on them) while the actual OS interaction lives here.
 */

export function runUnixCommand(
  command: string,
  args: string[],
  options: { allowNonZeroExit?: boolean } = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args);
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(
        new Error(
          `Command timed out after ${UNIX_COMMAND_TIMEOUT / 1000}s: ${command} ${args.join(' ')}`,
        ),
      );
    }, UNIX_COMMAND_TIMEOUT);

    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0 || options.allowNonZeroExit) {
        resolve(stdout);
        return;
      }
      const details = `${stderr}\n${stdout}`.trim();
      reject(
        new Error(
          details ||
            `Command failed with code ${code}: ${command} ${args.join(' ')}`,
        ),
      );
    });
  });
}

export async function getLinuxDefaultRouteInfo(): Promise<DefaultRouteInfo | null> {
  const routeOut = await runUnixCommand(
    'ip',
    ['-4', 'route', 'show', 'default'],
    { allowNonZeroExit: true },
  );
  const line = routeOut
    .split(/\r?\n/)
    .map((value) => value.trim())
    .find((value) => value.length > 0);
  if (!line) return null;

  const gatewayMatch = /\bvia\s+([0-9.]+)/.exec(line);
  const devMatch = /\bdev\s+([^\s]+)/.exec(line);
  if (!gatewayMatch || !devMatch) return null;

  const interfaceName = devMatch[1];
  const localAddress = await getLinuxInterfaceAddress(interfaceName);
  return {
    gateway: gatewayMatch[1],
    interfaceIndex: 0,
    interfaceName,
    localAddress,
  };
}

async function getLinuxInterfaceAddress(
  interfaceName: string,
): Promise<string | null> {
  const addrOut = await runUnixCommand(
    'ip',
    ['-4', '-o', 'addr', 'show', 'dev', interfaceName],
    { allowNonZeroExit: true },
  );
  const match = /\binet\s+([0-9.]+)\//.exec(addrOut);
  return match ? match[1] : null;
}

export async function getMacosDefaultRouteInfo(): Promise<DefaultRouteInfo | null> {
  const routeOut = await runUnixCommand('route', ['-n', 'get', 'default'], {
    allowNonZeroExit: true,
  });
  const gatewayMatch = /^\s*gateway:\s+([0-9.]+)\s*$/m.exec(routeOut);
  const interfaceMatch = /^\s*interface:\s+([^\s]+)\s*$/m.exec(routeOut);
  if (!gatewayMatch || !interfaceMatch) return null;

  const interfaceName = interfaceMatch[1];
  const localAddress = await getMacosInterfaceAddress(interfaceName);
  return {
    gateway: gatewayMatch[1],
    interfaceIndex: 0,
    interfaceName,
    localAddress,
  };
}

async function getMacosInterfaceAddress(
  interfaceName: string,
): Promise<string | null> {
  const output = await runUnixCommand(
    'ipconfig',
    ['getifaddr', interfaceName],
    { allowNonZeroExit: true },
  );
  const value = output.trim();
  return value.length > 0 ? value : null;
}
