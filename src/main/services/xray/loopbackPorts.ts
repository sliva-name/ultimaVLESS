import net from 'net';

export interface BusyLoopbackPort {
  port: number;
  code: string;
}

function tryListen(port: number): Promise<string | null> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once('error', (error: NodeJS.ErrnoException) =>
      resolve(error.code ?? 'EUNKNOWN'),
    );
    server.listen({ port, host: '127.0.0.1', exclusive: true }, () =>
      server.close(() => resolve(null)),
    );
  });
}

/**
 * The first of `ports` that cannot be bound on 127.0.0.1. Readiness only
 * checks that something accepts connections there, so another client on the
 * same port (v2rayN also defaults to 10808/10809) would pass for Xray.
 */
export async function findBusyLoopbackPort(
  ports: readonly number[],
): Promise<BusyLoopbackPort | null> {
  for (const port of ports) {
    const code = await tryListen(port);
    if (code) return { port, code };
  }
  return null;
}
