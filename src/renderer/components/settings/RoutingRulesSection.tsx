import React from 'react';
import clsx from 'clsx';
import { AlertTriangle, Route } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type {
  ConnectionMode,
  PerformanceSettings,
  RoutingMode,
} from '@/shared/types';
import { useKnownApps } from '@/renderer/hooks/useKnownApps';
import { AppListEditor } from './AppListEditor';
import { SplitTunnelEditor } from './SplitTunnelEditor';

interface RoutingRulesSectionProps {
  settings: PerformanceSettings;
  updateField: <K extends keyof PerformanceSettings>(
    key: K,
    value: PerformanceSettings[K],
  ) => void;
  connectionMode: ConnectionMode;
  locked: boolean;
}

const ROUTING_MODES: {
  mode: RoutingMode;
  labelKey: string;
  descKey: string;
}[] = [
  {
    mode: 'all',
    labelKey: 'settings.network.routingModeAll',
    descKey: 'settings.network.routingModeAllDesc',
  },
  {
    mode: 'sites',
    labelKey: 'settings.network.routingModeSites',
    descKey: 'settings.network.routingModeSitesDesc',
  },
  {
    mode: 'apps',
    labelKey: 'settings.network.routingModeApps',
    descKey: 'settings.network.routingModeAppsDesc',
  },
];

/**
 * "Routing rules": the default route plus the lists that override it. Lists of
 * the modes that are not selected stay saved but hidden, so switching back
 * restores them. Saved together with the rest of the network settings.
 */
export const RoutingRulesSection: React.FC<RoutingRulesSectionProps> = ({
  settings,
  updateField,
  connectionMode,
  locked,
}) => {
  const { t } = useTranslation();
  const { knownApps, appsLoading, refreshRunningApps, rememberPicked } =
    useKnownApps();

  const mode = settings.routingMode;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2.5 mb-1">
        <Route className="w-4 h-4 text-primary shrink-0" />
        <h3 className="text-sm font-semibold text-gray-200">
          {t('settings.network.routingRules')}
        </h3>
      </div>
      <p className="text-xs text-gray-500 leading-relaxed">
        {t('settings.network.routingRulesHint')}
      </p>

      {locked && (
        <div
          role="status"
          className="flex items-start gap-2.5 rounded-lg border border-orange-500/30 bg-orange-500/10 px-3 py-2 text-xs text-orange-200 leading-relaxed"
        >
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{t('settings.network.routingLocked')}</span>
        </div>
      )}

      <fieldset
        disabled={locked}
        aria-disabled={locked}
        className={clsx(
          'space-y-4 transition-opacity duration-200',
          locked && 'opacity-60 pointer-events-none select-none',
        )}
      >
        <div
          role="radiogroup"
          aria-label={t('settings.network.routingRules')}
          className="grid grid-cols-1 sm:grid-cols-3 gap-3"
        >
          {ROUTING_MODES.map((option) => {
            const active = mode === option.mode;
            return (
              <button
                key={option.mode}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => updateField('routingMode', option.mode)}
                className={clsx(
                  'p-3 rounded-xl border text-left transition-all duration-200',
                  active
                    ? 'border-primary/70 bg-primary/10 text-white'
                    : 'border-gray-700/50 bg-gray-800/40 text-gray-300 hover:border-gray-600/70',
                )}
              >
                <div className="text-sm font-semibold mb-1">
                  {t(option.labelKey)}
                </div>
                <div className="text-xs text-gray-400 leading-relaxed">
                  {t(option.descKey)}
                </div>
              </button>
            );
          })}
        </div>

        {mode === 'sites' && (
          <RuleList
            title={t('settings.network.routingProxySites')}
            hint={t('settings.network.routingProxySitesHint')}
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
          </RuleList>
        )}

        {mode === 'apps' && (
          <RuleList
            title={t('settings.network.routingProxyApps')}
            hint={t('settings.network.routingProxyAppsHint')}
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
          </RuleList>
        )}

        <RuleList
          title={t('settings.network.splitTunnel')}
          hint={t('settings.network.splitTunnelHint')}
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
        </RuleList>

        <RuleList
          title={t('settings.network.routingDirectApps')}
          hint={t('settings.network.routingDirectAppsHint')}
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
        </RuleList>

        <div className="space-y-1.5 text-xs text-gray-500 leading-relaxed">
          <p>{t('settings.network.routingAppsCaseNote')}</p>
          {connectionMode === 'proxy' && (
            <p className="text-orange-300/90">
              {t('settings.network.routingAppsProxyNote')}
            </p>
          )}
          <p>{t('settings.network.routingPriority')}</p>
          <p>{t('settings.network.splitTunnelDnsNote')}</p>
        </div>
      </fieldset>
    </div>
  );
};

const RuleList: React.FC<{
  title: string;
  hint: string;
  children: React.ReactNode;
}> = ({ title, hint, children }) => (
  <div className="space-y-2">
    <div>
      <div className="text-sm text-gray-200">{title}</div>
      <div className="text-xs text-gray-500 leading-relaxed mt-0.5">{hint}</div>
    </div>
    {children}
  </div>
);
