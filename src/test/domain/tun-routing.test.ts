import { describe, expect, it } from 'vitest';
import { DEFAULT_PERFORMANCE_SETTINGS } from '@/shared/types';
import {
  getWindowsTunRouteModeLabel,
  resolveTunAutoRoute,
  resolveTunBlockDnsLeaks,
  resolveWindowsTunRouting,
  usesWindowsPowerShellTunRouting,
} from '@/shared/tunRouting';

describe('tunRouting', () => {
  it('defaults Windows routing to xray', () => {
    expect(resolveWindowsTunRouting(null)).toBe('xray');
    expect(resolveWindowsTunRouting({})).toBe('xray');
    expect(
      resolveWindowsTunRouting({ windowsTunRouting: 'invalid' as 'xray' }),
    ).toBe('xray');
  });

  it('resolves tunAutoRoute per platform and Windows setting', () => {
    const xrayPerf = {
      ...DEFAULT_PERFORMANCE_SETTINGS,
      windowsTunRouting: 'xray' as const,
    };
    const psPerf = {
      ...DEFAULT_PERFORMANCE_SETTINGS,
      windowsTunRouting: 'powershell' as const,
    };

    expect(resolveTunAutoRoute('win32', xrayPerf)).toBe(true);
    expect(resolveTunAutoRoute('win32', psPerf)).toBe(false);
    expect(resolveTunAutoRoute('linux', psPerf)).toBe(true);
    expect(resolveTunAutoRoute('darwin', xrayPerf)).toBe(true);
  });

  it('blocks DNS leaks only on Windows with Xray auto-route', () => {
    const on = {
      ...DEFAULT_PERFORMANCE_SETTINGS,
      windowsTunRouting: 'xray' as const,
      tunBlockDnsLeaks: true,
    };

    expect(resolveTunBlockDnsLeaks('win32', on)).toBe(true);
    expect(
      resolveTunBlockDnsLeaks('win32', { ...on, tunBlockDnsLeaks: false }),
    ).toBe(false);
    // Xray refuses autoSystemWfpBlockLeak without autoSystemRoutingTable.
    expect(
      resolveTunBlockDnsLeaks('win32', {
        ...on,
        windowsTunRouting: 'powershell',
      }),
    ).toBe(false);
    // WFP is Windows-only; Linux auto-routes but has no such filters.
    expect(resolveTunBlockDnsLeaks('linux', on)).toBe(false);
    expect(resolveTunBlockDnsLeaks('darwin', on)).toBe(false);
    expect(resolveTunBlockDnsLeaks('win32', null)).toBe(false);
    expect(resolveTunBlockDnsLeaks('win32', DEFAULT_PERFORMANCE_SETTINGS)).toBe(
      false,
    );
  });

  it('detects PowerShell routing on Windows only', () => {
    expect(
      usesWindowsPowerShellTunRouting('win32', {
        windowsTunRouting: 'powershell',
      }),
    ).toBe(true);
    expect(
      usesWindowsPowerShellTunRouting('win32', {
        windowsTunRouting: 'xray',
      }),
    ).toBe(false);
    expect(
      usesWindowsPowerShellTunRouting('linux', {
        windowsTunRouting: 'powershell',
      }),
    ).toBe(false);
  });

  it('maps route mode labels', () => {
    expect(getWindowsTunRouteModeLabel('xray')).toBe('windows-xray-auto-route');
    expect(getWindowsTunRouteModeLabel('powershell')).toBe(
      'windows-static-routes',
    );
  });
});
