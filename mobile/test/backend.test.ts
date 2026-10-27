import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { XrayConfig } from '@/shared/xray-types';
import { FakeCore } from './fakeCore';

const fake = vi.hoisted(() => ({ core: null as FakeCore | null }));

vi.mock('../src/native/UltimaCore', async () => {
  const { FakeCore: Fake } = await import('./fakeCore');
  fake.core = new Fake();
  return { UltimaCore: fake.core.plugin };
});

const REALITY_LINK = (host: string, name: string) =>
  `vless://5f1c8b3e-2a7d-4e1b-9c3a-0d6e7f8a9b10@${host}:443?encryption=none&flow=xtls-rprx-vision&security=reality&sni=www.microsoft.com&fp=chrome&pbk=SbVKOEMjK0sIlbwg4akyBg5mL5KZwwB-ed4eEE7YnRc&sid=6ba85179e30d4fc2&type=tcp#${name}`;

async function waitFor(check: () => Promise<boolean>, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('Condition not met in time');
}

describe('Android backend', () => {
  let core: FakeCore;

  beforeAll(async () => {
    // Vitest runs on the host's Node; the WebView reports `android`.
    Object.defineProperty(process, 'platform', { value: 'android' });
    await import('../src/polyfills');
    const { UltimaCore } = await import('../src/native/UltimaCore');
    expect(UltimaCore).toBeDefined();
    core = fake.core!;
    // A disabled subscription keeps the first run from adding the built-in
    // public list, which would be fetched from the network.
    core.state = JSON.stringify({
      subscriptions: [
        {
          id: 'sub-off',
          name: 'Off',
          url: 'https://example.com/sub',
          enabled: false,
        },
      ],
    });
    const { bootBackend } = await import('../src/backend/boot');
    await bootBackend();
  });

  it('serves the desktop IPC surface with VPN as the default mode', async () => {
    const snapshot = await window.electronAPI.getAppSnapshot();
    expect(snapshot.connectionMode).toBe('tun');
    expect(snapshot.session.phase).toBe('idle');
    expect(snapshot.subscriptions).toHaveLength(1);
    const tun = await window.electronAPI.getTunCapabilityStatus();
    expect(tun).toMatchObject({
      platform: 'android',
      supported: true,
      hasPrivileges: true,
      privilegeHint: null,
    });
  });

  it('imports share links and connects through the VpnService', async () => {
    const saved = await window.electronAPI.saveManualLinks(
      `${REALITY_LINK('203.0.113.10', 'NL')}\n${REALITY_LINK('203.0.113.11', 'DE')}`,
    );
    expect(saved).toMatchObject({ ok: true, configCount: 2 });
    const { servers } = await window.electronAPI.getAppSnapshot();
    const nl = servers.find((server) => server.name === 'NL')!;

    const result = await window.electronAPI.connect(nl.uuid);
    expect(result).toEqual({ ok: true });

    const start = core.starts.at(-1)!;
    expect(start.mode).toBe('tun');
    expect(start.serverId).toBe(nl.uuid);
    expect(start.vpn).toMatchObject({
      mtu: 1400,
      ipv4Address: '172.19.0.1',
      dnsServers: ['1.1.1.1', '1.0.0.1'],
      allowedApps: [],
      disallowedApps: [],
    });
    const config = JSON.parse(start.config) as XrayConfig;
    expect(config.api).toBeUndefined();
    const tunInbound = config.inbounds?.find((i) => i.protocol === 'tun');
    expect(tunInbound?.settings).toEqual({ name: 'ultima0', mtu: 1400 });
    expect(config.outbounds?.[0]).toMatchObject({
      tag: 'proxy',
      protocol: 'vless',
    });
    expect(config.log?.error).toBe(
      '/data/user/0/com.ultima.vless/files/xray.log',
    );
    expect(JSON.stringify(config)).not.toContain('"tcpFastOpen":true');

    const snapshot = await window.electronAPI.getAppSnapshot();
    expect(snapshot.session).toMatchObject({
      phase: 'connected',
      activeServerId: nl.uuid,
    });
  });

  it('moves a running session to another server by reconnecting', async () => {
    const { servers } = await window.electronAPI.getAppSnapshot();
    const de = servers.find((server) => server.name === 'DE')!;
    const startsBefore = core.starts.length;
    expect(await window.electronAPI.connect(de.uuid)).toEqual({ ok: true });
    expect(core.starts.length).toBe(startsBefore + 1);
    expect(core.starts.at(-1)!.serverId).toBe(de.uuid);
    const snapshot = await window.electronAPI.getAppSnapshot();
    expect(snapshot.session).toMatchObject({
      phase: 'connected',
      activeServerId: de.uuid,
    });
  });

  it('follows a disconnect made from the notification', async () => {
    core.emitCore({ type: 'stopped', reason: 'user' });
    await waitFor(
      async () =>
        (await window.electronAPI.getAppSnapshot()).session.phase === 'idle',
    );
  });

  it('reports another VPN app taking the tunnel over', async () => {
    const { servers } = await window.electronAPI.getAppSnapshot();
    expect(await window.electronAPI.connect(servers[0].uuid)).toEqual({
      ok: true,
    });
    core.emitCore({ type: 'stopped', reason: 'revoked' });
    await waitFor(
      async () =>
        (await window.electronAPI.getAppSnapshot()).session.phase === 'failed',
    );
    const snapshot = await window.electronAPI.getAppSnapshot();
    expect(snapshot.session.lastError).toBe(
      'VPN was turned off by another VPN app',
    );
  });

  it('routes chosen apps through the VPN with the VpnService allow list', async () => {
    const perf = await window.electronAPI.getPerformanceSettings();
    await window.electronAPI.setPerformanceSettings({
      ...perf,
      routingMode: 'apps',
      proxyApps: ['org.telegram.messenger'],
    });
    const { servers } = await window.electronAPI.getAppSnapshot();
    expect(await window.electronAPI.connect(servers[0].uuid)).toEqual({
      ok: true,
    });
    const start = core.starts.at(-1)!;
    expect(start.vpn?.allowedApps).toEqual(['org.telegram.messenger']);
    const config = JSON.parse(start.config) as XrayConfig;
    const rules = config.routing?.rules ?? [];
    expect(rules.some((rule) => 'process' in rule)).toBe(false);
    expect(rules.at(-1)).toMatchObject({ outboundTag: 'proxy' });
    await window.electronAPI.disconnect();
  });

  it('pings servers while idle and, as on desktop, not during a session', async () => {
    const { servers } = await window.electronAPI.getAppSnapshot();
    const idle = await window.electronAPI.pingAllServers(true);
    expect(idle.every((result) => typeof result.latency === 'number')).toBe(
      true,
    );

    expect(await window.electronAPI.connect(servers[0].uuid)).toEqual({
      ok: true,
    });
    const serverProbes = () =>
      core.tcpHosts.filter((host) => host !== '127.0.0.1').length;
    const probesBefore = serverProbes();
    const connected = await window.electronAPI.pingAllServers(true);
    expect(connected.length).toBe(servers.length);
    expect(serverProbes()).toBe(probesBefore);
    await window.electronAPI.disconnect();
  });

  it('persists the catalog to the native store', async () => {
    const { flushAppStore } = await import('../src/platform/appStore');
    await flushAppStore();
    const stored = JSON.parse(core.state ?? '{}') as {
      servers?: unknown[];
      manualLinksInput?: string;
    };
    expect(stored.servers).toHaveLength(2);
    expect(stored.manualLinksInput).toContain('vless://');
  });
});
