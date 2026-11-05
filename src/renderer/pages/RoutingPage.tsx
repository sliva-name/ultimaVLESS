import React from 'react';
import clsx from 'clsx';
import { ArrowRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { RoutingMode } from '@/shared/types';
import type { NetworkSettings } from '@/renderer/hooks/useNetworkSettings';
import { useKnownApps } from '@/renderer/hooks/useKnownApps';
import {
  Foot,
  Panel,
  RadioRows,
  Row,
  RowGroup,
  Toggle,
} from '@/renderer/components/ui';
import { AppListEditor } from '@/renderer/components/settings/AppListEditor';
import { SplitTunnelEditor } from '@/renderer/components/settings/SplitTunnelEditor';
import { DraftPage, useSettingsLock } from './settings/DraftPage';

/** Steps of the rule order that are not plain: blocking first, the mode last. */
const FLOW_TONES = ['warn', '', '', '', '', 'info'] as const;

/**
 * «Маршрутизация»: the default route plus the lists that override it. Lists
 * of the modes that are not selected stay saved but hidden, so switching back
 * restores them. Saved together with the rest of the network settings.
 */
export const RoutingPage: React.FC<{ net: NetworkSettings }> = ({ net }) => {
  const { t } = useTranslation();
  const locked = useSettingsLock();
  const { perfSettings: settings, updatePerfField: updateField } = net;
  const { knownApps, appsLoading, refreshRunningApps, rememberPicked } =
    useKnownApps();
  const mode = settings.routingMode;
  const steps = t('pages.routing.prioritySteps', {
    returnObjects: true,
  }) as string[];

  return (
    <DraftPage
      net={net}
      title={t('pages.routing.title')}
      lead={t('settings.network.routingRulesHint')}
      lockText={t('settings.network.routingLocked')}
    >
      <Panel title={t('pages.routing.mode')} locked={locked}>
        <RadioRows<RoutingMode>
          label={t('settings.network.routingRules')}
          value={mode}
          onChange={(next) => updateField('routingMode', next)}
          options={[
            {
              value: 'all',
              label: t('settings.network.routingModeAll'),
              desc: t('settings.network.routingModeAllDesc'),
            },
            {
              value: 'sites',
              label: t('settings.network.routingModeSites'),
              desc: t('settings.network.routingModeSitesDesc'),
            },
            {
              value: 'apps',
              label: t('settings.network.routingModeApps'),
              desc: t('settings.network.routingModeAppsDesc'),
            },
          ]}
        />
      </Panel>

      {mode === 'sites' && (
        <Panel
          title={t('settings.network.routingProxySites')}
          desc={t('settings.network.routingProxySitesHint')}
          locked={locked}
        >
          <SplitTunnelEditor
            domains={settings.proxyDomains}
            ips={settings.proxyIps}
            disabled={locked}
            ariaLabel={t('settings.network.routingProxySites')}
            emptyText={t('settings.network.routingProxySitesEmpty')}
            onChange={({ domains, ips }) => {
              updateField('proxyDomains', domains);
              updateField('proxyIps', ips);
            }}
          />
        </Panel>
      )}

      {mode === 'apps' && (
        <Panel
          title={t('settings.network.routingProxyApps')}
          desc={t('settings.network.routingProxyAppsHint')}
          locked={locked}
        >
          <AppListEditor
            apps={settings.proxyApps}
            knownApps={knownApps}
            onPicked={rememberPicked}
            onOpenList={refreshRunningApps}
            loading={appsLoading}
            disabled={locked}
            ariaLabel={t('settings.network.routingProxyApps')}
            emptyText={t('settings.network.routingProxyAppsEmpty')}
            onChange={(apps) => updateField('proxyApps', apps)}
          />
        </Panel>
      )}

      <Panel
        title={t('settings.network.splitTunnel')}
        desc={t('settings.network.splitTunnelHint')}
        locked={locked}
        foot={<Foot>{t('settings.network.splitTunnelDnsNote')}</Foot>}
      >
        <SplitTunnelEditor
          domains={settings.bypassDomains}
          ips={settings.bypassIps}
          disabled={locked}
          emptyText={
            mode === 'all'
              ? t('settings.network.splitTunnelEmpty')
              : t('settings.network.routingExclusionsEmpty')
          }
          onChange={({ domains, ips }) => {
            updateField('bypassDomains', domains);
            updateField('bypassIps', ips);
          }}
        />
      </Panel>

      <Panel
        title={t('settings.network.routingDirectApps')}
        desc={t('settings.network.routingDirectAppsHint')}
        locked={locked}
        foot={
          <>
            <Foot>{t('settings.network.routingAppsCaseNote')}</Foot>
            {net.connectionMode === 'proxy' && (
              <Foot tone="warn">
                {t('settings.network.routingAppsProxyNote')}
              </Foot>
            )}
          </>
        }
      >
        <AppListEditor
          apps={settings.directApps}
          knownApps={knownApps}
          onPicked={rememberPicked}
          onOpenList={refreshRunningApps}
          loading={appsLoading}
          disabled={locked}
          ariaLabel={t('settings.network.routingDirectApps')}
          emptyText={t('settings.network.routingDirectAppsEmpty')}
          onChange={(apps) => updateField('directApps', apps)}
        />
      </Panel>

      <Panel title={t('pages.routing.blocking')} locked={locked}>
        <RowGroup>
          <Row
            label={t('settings.network.blockAds')}
            hint={t('settings.network.blockAdsHint')}
            trailing={
              <Toggle
                checked={settings.blockAds}
                onChange={(v) => updateField('blockAds', v)}
                ariaLabel={t('settings.network.blockAds')}
              />
            }
          />
          <Row
            label={t('settings.network.blockBittorrent')}
            hint={t('settings.network.blockBittorrentHint')}
            trailing={
              <Toggle
                checked={settings.blockBittorrent}
                onChange={(v) => updateField('blockBittorrent', v)}
                ariaLabel={t('settings.network.blockBittorrent')}
              />
            }
          />
        </RowGroup>
      </Panel>

      <Panel
        title={t('pages.routing.priority')}
        note={t('pages.routing.priorityNote')}
        foot={<Foot>{t('pages.routing.priorityFoot')}</Foot>}
      >
        <ol className="m-0 p-0 list-none flex flex-wrap items-center gap-2">
          {steps.map((label, index) => {
            const tone = FLOW_TONES[index];
            return (
              <li key={label} className="inline-flex items-center gap-2">
                <span
                  className={clsx(
                    'h-7 box-border inline-flex items-center gap-1.5 px-2.5 rounded-md border text-xs leading-4 font-medium',
                    tone === 'warn'
                      ? 'bg-warn-soft border-warn-line text-warn'
                      : tone === 'info'
                        ? 'bg-acc-soft border-acc-line text-acc'
                        : 'bg-s1 border-line text-fg',
                  )}
                >
                  <span className="tabular-nums opacity-70">{index + 1}</span>
                  {label}
                </span>
                {index < steps.length - 1 && (
                  <ArrowRight
                    aria-hidden
                    strokeWidth={2}
                    className="w-3.5 h-3.5 text-fg3"
                  />
                )}
              </li>
            );
          })}
        </ol>
      </Panel>
    </DraftPage>
  );
};
