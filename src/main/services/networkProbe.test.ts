import { EventEmitter } from 'events';
import tls from 'tls';
import { describe, expect, it, vi } from 'vitest';
import { probeTlsHandshake } from './networkProbe';

vi.mock('tls', () => ({
  default: {
    connect: vi.fn(),
  },
}));

function createTlsSocket(): EventEmitter & {
  setTimeout: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
} {
  const socket = new EventEmitter() as EventEmitter & {
    setTimeout: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
  };
  socket.setTimeout = vi.fn();
  socket.destroy = vi.fn();
  return socket;
}

describe('probeTlsHandshake', () => {
  it('omits TLS servername when SNI is an IP address', async () => {
    const socket = createTlsSocket();
    vi.mocked(tls.connect).mockReturnValue(socket as tls.TLSSocket);

    const resultPromise = probeTlsHandshake(
      '193.27.19.70',
      443,
      '193.27.19.70',
    );
    socket.emit('secureConnect');

    await expect(resultPromise).resolves.toBe(true);
    expect(tls.connect).toHaveBeenCalledWith(
      expect.not.objectContaining({ servername: expect.any(String) }),
    );
  });

  it('uses TLS servername when SNI is a domain name', async () => {
    const socket = createTlsSocket();
    vi.mocked(tls.connect).mockReturnValue(socket as tls.TLSSocket);

    const resultPromise = probeTlsHandshake('193.27.19.70', 443, 'apple.com');
    socket.emit('secureConnect');

    await expect(resultPromise).resolves.toBe(true);
    expect(tls.connect).toHaveBeenCalledWith(
      expect.objectContaining({ servername: 'apple.com' }),
    );
  });
});
