import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  REMOTE_DNS_PRESET_SERVERS,
  type RemoteDnsPreset,
  type TunDnsQueryStrategy,
} from '@/shared/types';
import type { NetworkSettings } from '@/renderer/hooks/useNetworkSettings';
import { Panel, RadioRows, TextField } from '@/renderer/components/ui';
import { DraftPage, useSettingsLock } from './DraftPage';

/** «DNS»: remote resolvers and the TUN query strategy. */
export const DnsPage: React.FC<{ net: NetworkSettings }> = ({ net }) => {
  const { t } = useTranslation();
  const locked = useSettingsLock();
  const { perfSettings, updatePerfField } = net;
  const servers = perfSettings.remoteDnsServers;

  const customFields = (
    <div className="flex flex-col gap-2 pl-11 pr-4 pb-3">
      <label className="flex items-center justify-between gap-3">
        <span className="text-xs leading-4 text-fg2">
          {t('settings.network.remoteDnsPrimary')}
        </span>
        <TextField
          mono
          className="w-40"
          value={servers[0] ?? ''}
          placeholder="1.1.1.1"
          onChange={(e) => {
            const primary = e.target.value;
            const secondary = servers[1];
            updatePerfField(
              'remoteDnsServers',
              secondary ? [primary, secondary] : [primary],
            );
          }}
        />
      </label>
      <label className="flex items-center justify-between gap-3">
        <span className="text-xs leading-4 text-fg2">
          {t('settings.network.remoteDnsSecondary')}
        </span>
        <TextField
          mono
          className="w-40"
          value={servers[1] ?? ''}
          placeholder="1.0.0.1"
          onChange={(e) => {
            const secondary = e.target.value;
            const primary = servers[0] ?? '';
            updatePerfField(
              'remoteDnsServers',
              secondary.trim()
                ? [primary, secondary]
                : primary
                  ? [primary]
                  : [],
            );
          }}
        />
      </label>
    </div>
  );

  return (
    <DraftPage
      net={net}
      title={t('pages.dns.title')}
      lead={t('pages.dns.lead')}
      lockText={t('settings.network.performanceLocked')}
    >
      <Panel
        title={t('settings.network.remoteDns')}
        desc={t('settings.network.remoteDnsHint')}
        locked={locked}
      >
        <RadioRows<RemoteDnsPreset>
          label={t('settings.network.remoteDns')}
          value={perfSettings.remoteDnsPreset}
          onChange={(preset) => {
            updatePerfField('remoteDnsPreset', preset);
            if (preset !== 'custom') {
              updatePerfField('remoteDnsServers', [
                ...REMOTE_DNS_PRESET_SERVERS[preset],
              ]);
            }
          }}
          extra={{ custom: customFields }}
          options={[
            {
              value: 'cloudflare',
              label: t('settings.network.remoteDnsCloudflare'),
              desc: REMOTE_DNS_PRESET_SERVERS.cloudflare.join(' · '),
            },
            {
              value: 'google',
              label: t('settings.network.remoteDnsGoogle'),
              desc: REMOTE_DNS_PRESET_SERVERS.google.join(' · '),
            },
            {
              value: 'quad9',
              label: t('settings.network.remoteDnsQuad9'),
              desc: REMOTE_DNS_PRESET_SERVERS.quad9.join(' · '),
            },
            {
              value: 'custom',
              label: t('settings.network.remoteDnsCustom'),
              desc:
                servers.length > 0 && perfSettings.remoteDnsPreset === 'custom'
                  ? servers.join(' · ')
                  : 'IPv4',
            },
          ]}
        />
      </Panel>

      <Panel
        title={t('settings.network.tunDnsQueryStrategy')}
        desc={t('settings.network.tunDnsQueryStrategyHint')}
        locked={locked}
      >
        <RadioRows<TunDnsQueryStrategy>
          label={t('settings.network.tunDnsQueryStrategy')}
          value={perfSettings.tunDnsQueryStrategy}
          onChange={(v) => updatePerfField('tunDnsQueryStrategy', v)}
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
    </DraftPage>
  );
};
