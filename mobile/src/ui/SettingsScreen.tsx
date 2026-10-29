import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Subscription, VlessConfig } from '@/shared/types';
import { localizeError } from '@/shared/localizeError';
import { useAppSnapshot } from '@/renderer/hooks/useAppSnapshot';
import { useKnownApps } from '@/renderer/hooks/useKnownApps';
import { useNetworkSettings } from '@/renderer/hooks/useNetworkSettings';
import { useSettingsMonitor } from '@/renderer/hooks/useSettingsMonitor';
import { useSourcesSettings } from '@/renderer/hooks/useSourcesSettings';
import { useUpdateStatus } from '@/renderer/hooks/useUpdateStatus';
import type { AppListKind, MobileRoute, SettingsPage } from './useMobileNav';
import { AboutPage } from './settings/AboutPage';
import { CorePage } from './settings/CorePage';
import { DiagnosticsPage } from './settings/DiagnosticsPage';
import { ErrorText, LockBanner, SaveBar, SubHeader } from './settings/kit';
import { NetworkPage } from './settings/NetworkPage';
import { countChanges } from './settings/options';
import { AppsPage, RoutingPage } from './settings/RoutingPage';
import { LanguageSwitch, SettingsRoot } from './settings/SettingsRoot';
import { SourcesPage, SubscriptionSheet } from './settings/SourcesPage';

type NetworkSettings = ReturnType<typeof useNetworkSettings>;

/** Screens whose fields are read-only under a live session. */
const LOCKABLE: SettingsPage[] = ['network', 'routing', 'core', 'apps'];
/** Screens that edit the saved network settings. */
const EDITING: SettingsPage[] = ['network', 'routing', 'core'];

interface SettingsScreenProps {
  route: MobileRoute;
  servers: VlessConfig[];
  subscriptions: Subscription[];
  isConnected: boolean;
  isConnectionBusy: boolean;
  onToggleConnection: () => void;
  /** Opens a screen above the current one. */
  onOpen: (page: SettingsPage, extra?: Partial<MobileRoute>) => void;
  onBack: () => void;
}

/** Routing and its app picker share one list of installed apps. */
const RoutingScreens: React.FC<{
  page: 'routing' | 'apps';
  list: AppListKind;
  net: NetworkSettings;
  locked: boolean;
  onPickApps: (list: AppListKind) => void;
}> = ({ page, list, net, locked, onPickApps }) => {
  const { knownApps, appsLoading } = useKnownApps();
  return page === 'apps' ? (
    <AppsPage
      net={net}
      list={list}
      locked={locked}
      knownApps={knownApps}
      loading={appsLoading}
    />
  ) : (
    <RoutingPage
      net={net}
      locked={locked}
      connectionMode={net.connectionMode}
      knownApps={knownApps}
      onPickApps={onPickApps}
    />
  );
};

/** Settings as a list of sections, each opening its own screen. */
export const SettingsScreen: React.FC<SettingsScreenProps> = ({
  route,
  servers,
  subscriptions,
  isConnected,
  isConnectionBusy,
  onToggleConnection,
  onOpen,
  onBack,
}) => {
  const { t, i18n } = useTranslation();
  const page = route.page;
  const list = route.list ?? 'direct';
  const snapshot = useAppSnapshot();
  const net = useNetworkSettings(true);
  const sources = useSourcesSettings(true);
  const { recentEvents } = useSettingsMonitor({ isOpen: true });
  const { status: update, installUpdate } = useUpdateStatus();
  const [appVersion, setAppVersion] = useState('');
  const [perfError, setPerfError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    window.electronAPI
      .getAppVersion()
      .then((version) => {
        if (!disposed) setAppVersion(version);
      })
      .catch((err) => console.error('Failed to read the app version:', err));
    return () => {
      disposed = true;
    };
  }, []);

  const locked = isConnected || isConnectionBusy;
  const changes = countChanges(net.perfSettings, net.perfBaseline);

  const save = useCallback(async () => {
    setPerfError(null);
    try {
      await net.savePerfSettings();
    } catch (err) {
      console.error('Failed to save performance settings:', err);
      setPerfError(
        err instanceof Error
          ? err.message
          : t('settings.network.savePerfFailed'),
      );
    }
  }, [net, t]);

  const refreshAll = useCallback(async () => {
    setRefreshError(null);
    setRefreshing(true);
    try {
      const result = await window.electronAPI.refreshSubscriptions();
      if (!result.ok && result.error) setRefreshError(result.error);
    } catch (err) {
      setRefreshError(
        err instanceof Error
          ? err.message
          : t('settings.sources.errors.fetchFailed'),
      );
    } finally {
      setRefreshing(false);
    }
  }, [t]);

  const titles: Record<SettingsPage, string> = {
    root: t('settings.title'),
    sources: t('settings.sources.subscriptions'),
    network: t('mobile.settings.network'),
    routing: t('mobile.settings.routing'),
    apps: t(
      list === 'direct'
        ? 'settings.network.routingDirectApps'
        : 'settings.network.routingProxyApps',
    ),
    core: t('mobile.settings.core'),
    diag: t('settings.tabs.diagnostics'),
    about: t('mobile.settings.about'),
  };

  const header =
    page === 'root' ? (
      <header className="h-16 shrink-0 flex items-center gap-3 pl-5 pr-4">
        <h1 className="flex-1 m-0 text-[22px] leading-7 font-semibold tracking-[-0.02em]">
          {titles.root}
        </h1>
        <LanguageSwitch />
      </header>
    ) : page === 'apps' ? (
      <SubHeader
        modal
        title={titles.apps}
        sub={t('mobile.settings.selectedApps', {
          count:
            net.perfSettings[list === 'direct' ? 'directApps' : 'proxyApps']
              .length,
        })}
        onBack={onBack}
        action={
          <button
            type="button"
            onClick={onBack}
            className="h-10 px-3 rounded-xl bg-acc-fill text-white text-sm leading-4 font-medium whitespace-nowrap"
          >
            {t('mobile.done')}
          </button>
        }
      />
    ) : page === 'sources' ? (
      <SubHeader
        title={titles.sources}
        sub={`${t('mobile.count.subscriptions', { count: subscriptions.length })} · ${t(
          'mobile.count.servers',
          { count: servers.length },
        )}`}
        onBack={onBack}
        action={
          <button
            type="button"
            onClick={() => void refreshAll()}
            disabled={refreshing || subscriptions.length === 0}
            aria-label={t('mobile.settings.sources.refreshAll')}
            title={t('mobile.settings.sources.refreshAll')}
            className="w-10 h-10 inline-flex items-center justify-center rounded-xl text-fg disabled:opacity-40"
          >
            <RefreshCw
              aria-hidden
              strokeWidth={2}
              className={
                refreshing
                  ? 'w-[18px] h-[18px] animate-spin'
                  : 'w-[18px] h-[18px]'
              }
            />
          </button>
        }
      />
    ) : (
      <SubHeader title={titles[page]} onBack={onBack} />
    );

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {header}

      {locked && LOCKABLE.includes(page) && (
        <LockBanner
          text={t(
            page === 'routing' || page === 'apps'
              ? 'settings.network.routingLocked'
              : 'settings.network.performanceLocked',
          )}
          onDisconnect={onToggleConnection}
          disconnectDisabled={snapshot.session.phase === 'disconnecting'}
        />
      )}

      {page === 'root' && (
        <SettingsRoot
          servers={servers}
          subscriptions={subscriptions}
          settings={net.perfBaseline}
          connectionMode={net.connectionMode}
          snapshot={snapshot}
          appVersion={appVersion}
          update={update}
          onOpen={(next) => onOpen(next)}
        />
      )}
      {page === 'sources' && (
        <SourcesPage
          subscriptions={subscriptions}
          servers={servers}
          sources={sources}
          refreshError={refreshError}
          onAddSubscription={() => onOpen('sources', { sheet: true })}
        />
      )}
      {page === 'network' && (
        <NetworkPage net={net} locked={locked} busy={isConnectionBusy} />
      )}
      {(page === 'routing' || page === 'apps') && (
        <RoutingScreens
          page={page}
          list={list}
          net={net}
          locked={locked}
          onPickApps={(next) => onOpen('apps', { list: next })}
        />
      )}
      {page === 'core' && <CorePage net={net} locked={locked} />}
      {page === 'diag' && (
        <DiagnosticsPage
          servers={servers}
          snapshot={snapshot}
          recentEvents={recentEvents}
        />
      )}
      {page === 'about' && (
        <AboutPage
          appVersion={appVersion}
          update={update}
          installUpdate={installUpdate}
        />
      )}

      {perfError && EDITING.includes(page) && (
        <div className="shrink-0 px-4 pb-2">
          <ErrorText>{localizeError(perfError, i18n.language)}</ErrorText>
        </div>
      )}
      {net.perfDirty && changes > 0 && !locked && EDITING.includes(page) && (
        <SaveBar
          changes={changes}
          saving={net.perfSaving}
          onDiscard={() => {
            setPerfError(null);
            net.revertPerfSettings();
          }}
          onSave={() => void save()}
        />
      )}
      {page === 'apps' && <div className="mobile-inset-bottom shrink-0" />}

      {route.sheet && page === 'sources' && (
        <SubscriptionSheet sources={sources} onClose={onBack} />
      )}
    </div>
  );
};
