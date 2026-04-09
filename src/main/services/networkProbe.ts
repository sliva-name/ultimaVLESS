import net from 'net';
import tls from 'tls';
import http from 'http';

export async function probeTcpPort(port: number, host: string = '127.0.0.1', timeoutMs: number = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let settled = false;

    const finish = (result: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.once('close', () => finish(false));
  });
}

/**
 * Attempts a TLS handshake to the given host:port with the specified SNI.
 * Returns true if the handshake succeeds (certificate validity is not checked).
 * Useful for detecting broken TLS/Reality configs that pass raw TCP ping but fail in practice.
 */
export async function probeTlsHandshake(host: string, port: number, sni: string, timeoutMs: number = 4000): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;

    const finish = (result: boolean) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch { /* ignore */ }
      resolve(result);
    };

    const socket = tls.connect({
      host,
      port,
      servername: sni,
      rejectUnauthorized: false,
      enableTrace: false,
    });

    socket.setTimeout(timeoutMs);
    socket.once('secureConnect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.once('timeout', () => finish(false));
    socket.once('close', () => finish(false));
  });
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function probeHttpThroughProxyOnce(
  proxyPort: number,
  proxyHost: string,
  timeoutMs: number,
  targetHost: string,
  targetPath: string,
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;

    const finish = (result: boolean) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const req = http.request({
      host: proxyHost,
      port: proxyPort,
      path: `http://${targetHost}${targetPath}`,
      method: 'GET',
      headers: { Host: targetHost, 'User-Agent': 'Mozilla/5.0', Connection: 'close' },
    });

    req.setTimeout(timeoutMs, () => {
      req.destroy();
      finish(false);
    });

    req.once('response', (res) => {
      res.resume(); // drain the body
      const status = res.statusCode || 0;
      finish(status >= 200 && status < 400);
    });

    req.once('error', () => finish(false));
    req.end();
  });
}

function probeHttpThroughProxyAny(
  proxyPort: number,
  proxyHost: string,
  timeoutMs: number,
): Promise<boolean> {
  const targets = [
    { host: 'connectivitycheck.gstatic.com', path: '/generate_204' },
    { host: '1.1.1.1', path: '/' },
    { host: 'captive.apple.com', path: '/hotspot-detect.html' },
  ];

  return new Promise((resolve) => {
    let pending = targets.length;
    let resolved = false;

    for (const target of targets) {
      probeHttpThroughProxyOnce(proxyPort, proxyHost, timeoutMs, target.host, target.path).then(res => {
        if (resolved) return;
        if (res) {
          resolved = true;
          resolve(true);
        } else {
          pending--;
          if (pending === 0) resolve(false);
        }
      });
    }
  });
}

/**
 * Makes an HTTP request through a local HTTP proxy to a neutral connectivity check URL
 * and expects HTTP 204. Retries a few times — single-shot probes often flake on slow links
 * or right after Xray warms up.
 */
export async function probeHttpThroughProxy(
  proxyPort: number,
  proxyHost: string = '127.0.0.1',
  timeoutMs: number = 10000,
): Promise<boolean> {
  const attempts = 3;
  const gapMs = 350;
  for (let i = 0; i < attempts; i++) {
    if (await probeHttpThroughProxyAny(proxyPort, proxyHost, timeoutMs)) {
      return true;
    }
    if (i < attempts - 1) {
      await sleep(gapMs);
    }
  }
  return false;
}
