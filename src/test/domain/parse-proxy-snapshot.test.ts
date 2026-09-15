import { describe, expect, it } from 'vitest';
import { parseProxySnapshot } from '@/main/services/systemProxy/parseSnapshot';

const windowsOk = {
  platform: 'win32',
  proxyEnable: 0,
  proxyServer: 'http=127.0.0.1:8080;https=127.0.0.1:8080',
  proxyOverride: 'localhost;127.*;<local>',
  autoConfigUrl: null,
  autoDetect: 0,
};

describe('parseProxySnapshot', () => {
  it('accepts a snapshot this process would write', () => {
    expect(parseProxySnapshot(windowsOk)).toEqual(windowsOk);
  });

  it('rejects a forged WinINET proxy or PAC scheme', () => {
    expect(
      parseProxySnapshot({
        ...windowsOk,
        proxyServer: 'evil.example\nProxyEnable=1',
      }),
    ).toBeNull();
    expect(
      parseProxySnapshot({
        ...windowsOk,
        autoConfigUrl: 'file:///C:/temp/pac.js',
      }),
    ).toBeNull();
    expect(
      parseProxySnapshot({
        ...windowsOk,
        proxyEnable: 2,
      }),
    ).toBeNull();
  });

  it('rejects an unknown platform or non-object payload', () => {
    expect(parseProxySnapshot(null)).toBeNull();
    expect(parseProxySnapshot({ platform: 'plan9' })).toBeNull();
    expect(parseProxySnapshot('{"platform":"win32"}')).toBeNull();
  });
});
