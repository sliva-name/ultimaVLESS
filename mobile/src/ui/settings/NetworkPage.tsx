import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  REMOTE_DNS_PRESET_SERVERS,
  TUN_MTU_MAX,
  TUN_MTU_MIN,
  type ConnectionMode,
  type PingMethod,
  type RemoteDnsPreset,
  type TunDnsQueryStrategy,
} from '@/shared/types';
import { localizeError } from '@/shared/localizeError';
import type { useNetworkSettings } from '@/renderer/hooks/useNetworkSettings';
import {
  ChoiceCards,
  type ChoiceOption,
  ErrorText,
  Foot,
  NumberRow,
  PageBody,
  Panel,
  RadioRows,
  Row,
  RowGroup,
} from './kit';

type NetworkSettings = ReturnType<typeof useNetworkSettings>;

interface NetworkPageProps {
  net: NetworkSettings;
  /** Connected or in flight: everything but the mode is read-only. */
  locked: boolean;
  busy: boolean;
}

const DnsField: React.FC<{
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}> = ({ label, value, placeholder, onChange }) => (
  <Row
    label={label}
    trailing={
      <input
        type="text"
        inputMode="decimal"
        value={value}
        placeholder={placeholder}
        aria-label={label}
        onChange={(e) => onChange(e.target.value)}
        className="shrink-0 w-36 h-10 px-3 rounded-[10px] border border-line2 bg-s2 text-fg font-mono text-sm text-right outline-none focus:border-acc-fill"
      />
    }
  />
);

/** Connection mode, ping method, DNS and the tunnel MTU. */
export const NetworkPage: React.FC<NetworkPageProps> = ({
  net,
  locked,
  busy,
}) => {
  const { t, i18n } = useTranslation();
  const { perfSettings: settings, updatePerfField: update } = net;

  const chooseMode = useCallback(
    async (mode: ConnectionMode) => {
      if (mode === net.connectionMode) return;
      if (busy) {
        net.setModeError(t('settings.network.disconnectHintError'));
        return;
      }
      try {
        await net.setConnectionMode(mode);
      } catch (err) {
        console.error('Failed to set connection mode:', err);
        net.setModeError(
          err instanceof Error
            ? err.message
            : t('settings.network.setModeFailed'),
        );
      }
    },
    [busy, net, t],
  );

  const dnsOptions: ChoiceOption<RemoteDnsPreset>[] = [
    ...(
      [
        ['cloudflare', 'Cloudflare'],
        ['google', 'Google'],
        ['quad9', 'Quad9'],
      ] as const
    ).map(([value, label]) => ({
      value,
      label,
      desc: REMOTE_DNS_PRESET_SERVERS[value].join(' · '),
    })),
    {
      value: 'custom',
      label: t('settings.network.remoteDnsCustom'),
      desc:
        settings.remoteDnsPreset === 'custom' &&
        settings.remoteDnsServers.length > 0
          ? settings.remoteDnsServers.join(' · ')
          : 'IPv4',
    },
  ];

  return (
    <PageBody>
      <Panel
        title={t('settings.network.mode')}
        note={t('mobile.settings.modeNote')}
        foot={<Foot>{t('settings.network.modeReconnectHint')}</Foot>}
      >
        <ChoiceCards<ConnectionMode>
          label={t('settings.network.mode')}
          value={net.connectionMode}
          onChange={(mode) => void chooseMode(mode)}
          disabled={busy}
          options={[
            {
              value: 'tun',
              label: t('settings.network.tunMode'),
              desc: t('settings.network.tunDesc'),
            },
            {
              value: 'proxy',
              label: t('settings.network.proxyMode'),
              desc: t('settings.network.proxyDesc'),
            },
          ]}
        />
        {net.modeError && (
          <ErrorText>{localizeError(net.modeError, i18n.language)}</ErrorText>
        )}
      </Panel>

      <Panel
        title={t('settings.network.pingMethod')}
        locked={locked}
        foot={<Foot>{t('settings.network.pingMethodHint')}</Foot>}
      >
        <ChoiceCards<PingMethod>
          label={t('settings.network.pingMethod')}
          columns={2}
          value={settings.pingMethod}
          onChange={(method) => update('pingMethod', method)}
          options={[
            {
              value: 'real',
              label: t('settings.network.pingMethodReal'),
              desc: t('settings.network.pingMethodRealDesc'),
            },
            {
              value: 'tcp',
              label: t('settings.network.pingMethodTcp'),
              desc: t('settings.network.pingMethodTcpDesc'),
            },
          ]}
        />
      </Panel>

      <Panel
        title={t('settings.network.remoteDns')}
        desc={t('settings.network.remoteDnsHint')}
        locked={locked}
      >
        <RadioRows<RemoteDnsPreset>
          label={t('settings.network.remoteDns')}
          value={settings.remoteDnsPreset}
          options={dnsOptions}
          onChange={(preset) => {
            update('remoteDnsPreset', preset);
            if (preset !== 'custom') {
              update('remoteDnsServers', [
                ...REMOTE_DNS_PRESET_SERVERS[preset],
              ]);
            }
          }}
        />
        {settings.remoteDnsPreset === 'custom' && (
          <RowGroup>
            <DnsField
              label={t('settings.network.remoteDnsPrimary')}
              value={settings.remoteDnsServers[0] ?? ''}
              placeholder="1.1.1.1"
              onChange={(primary) => {
                const secondary = settings.remoteDnsServers[1];
                update(
                  'remoteDnsServers',
                  secondary ? [primary, secondary] : [primary],
                );
              }}
            />
            <DnsField
              label={t('settings.network.remoteDnsSecondary')}
              value={settings.remoteDnsServers[1] ?? ''}
              placeholder="1.0.0.1"
              onChange={(secondary) => {
                const primary = settings.remoteDnsServers[0] ?? '';
                update(
                  'remoteDnsServers',
                  secondary.trim()
                    ? [primary, secondary]
                    : primary
                      ? [primary]
                      : [],
                );
              }}
            />
          </RowGroup>
        )}
      </Panel>

      <Panel
        title={t('settings.network.tunDnsQueryStrategy')}
        desc={t('settings.network.tunDnsQueryStrategyHint')}
        locked={locked}
      >
        <RadioRows<TunDnsQueryStrategy>
          label={t('settings.network.tunDnsQueryStrategy')}
          value={settings.tunDnsQueryStrategy}
          onChange={(strategy) => update('tunDnsQueryStrategy', strategy)}
          options={[
            {
              value: 'UseIPv4',
              label: t('settings.network.tunDnsUseIPv4'),
              desc: t('settings.network.tunDnsUseIPv4Desc'),
            },
            {
              value: 'UseIPv6',
              label: t('settings.network.tunDnsUseIPv6'),
              desc: t('settings.network.tunDnsUseIPv6Desc'),
            },
            {
              value: 'UseIP',
              label: t('settings.network.tunDnsUseIP'),
              desc: t('settings.network.tunDnsUseIPDesc'),
            },
            {
              value: 'UseSystem',
              label: t('settings.network.tunDnsUseSystem'),
              desc: t('settings.network.tunDnsUseSystemDesc'),
            },
          ]}
        />
      </Panel>

      <Panel title={t('mobile.settings.tunnel')} locked={locked}>
        <RowGroup>
          <NumberRow
            label={t('settings.network.tunMtu')}
            hint={t('settings.network.tunMtuHint')}
            value={settings.tunMtu}
            min={TUN_MTU_MIN}
            max={TUN_MTU_MAX}
            onChange={(mtu) => update('tunMtu', mtu)}
          />
        </RowGroup>
      </Panel>
    </PageBody>
  );
};
