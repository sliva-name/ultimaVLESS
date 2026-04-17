import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import clsx from 'clsx';
import { Settings, Server, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Subscription, VlessConfig } from '@/shared/types';
import logoUrl from '@/renderer/assets/logo.svg';
import {
  ORPHAN_GROUP_COLOR,
  MANUAL_GROUP_COLOR,
  buildManualServers,
  buildOrphanSubscriptionServers,
  buildSubscriptionGroups,
  getSubscriptionColor,
} from './sidebarModel';
import { ServerGroup } from './sidebar/ServerGroup';

interface SidebarProps {
  servers: VlessConfig[];
  subscriptions: Subscription[];
  selectedServer: VlessConfig | null;
  isConnected: boolean;
  onSelectServer: (server: VlessConfig) => void;
  onOpenSettings: () => void;
  onPingAll?: () => Promise<void>;
}

export const Sidebar: React.FC<SidebarProps> = ({
  servers,
  subscriptions,
  selectedServer,
  isConnected,
  onSelectServer,
  onOpenSettings,
  onPingAll,
}) => {
  const { t } = useTranslation();
  const [appVersion, setAppVersion] = useState<string>('');
  const [isPinging, setIsPinging] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const didScrollToSelectedRef = useRef(false);
  const lastScrolledUuidRef = useRef<string | null>(null);

  const subscriptionGroups = useMemo(
    () => buildSubscriptionGroups(subscriptions, servers),
    [subscriptions, servers]
  );
  const orphanSubscriptionServers = useMemo(
    () => buildOrphanSubscriptionServers(servers),
    [servers]
  );
  const manualServers = useMemo(
    () => buildManualServers(servers),
    [servers]
  );

  useEffect(() => {
    window.electronAPI.getAppVersion()
      .then(setAppVersion)
      .catch(() => setAppVersion(''));
  }, []);

  useEffect(() => {
    if (!selectedServer) return;
    // Re-scroll whenever the selected server actually changes, not only on the
    // very first render — otherwise keyboard/remote navigation that switches
    // to a server that's offscreen will leave it out of view.
    if (lastScrolledUuidRef.current === selectedServer.uuid && didScrollToSelectedRef.current) {
      return;
    }
    const container = scrollContainerRef.current;
    if (!container) return;
    const el = container.querySelector(`[data-server-uuid="${selectedServer.uuid}"]`);
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest' });
      didScrollToSelectedRef.current = true;
      lastScrolledUuidRef.current = selectedServer.uuid;
    }
  }, [selectedServer, servers]);

  const handlePingAll = useCallback(async () => {
    if (!onPingAll || isPinging) return;
    setIsPinging(true);
    try {
      await onPingAll();
    } finally {
      setIsPinging(false);
    }
  }, [onPingAll, isPinging]);

  return (
    <div className="w-full md:w-72 md:shrink-0 max-h-[44vh] md:max-h-none min-h-0 bg-linear-to-b from-surface via-surface to-surface/95 backdrop-blur-xl border-b md:border-b-0 md:border-r border-gray-800/50 flex flex-col shadow-2xl shadow-black/30 relative overflow-hidden">
      <div className="absolute inset-0 bg-linear-to-br from-primary/5 via-transparent to-transparent pointer-events-none" />

      <div className="relative z-10 p-5 border-b border-gray-800/50 bg-linear-to-r from-surface to-surface/95 backdrop-blur-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-1.5 rounded-xl bg-linear-to-br from-primary/20 to-primary/10 border border-primary/30 shadow-lg shadow-primary/10">
              <img src={logoUrl} alt="UltimaVLESS logo" className="w-8 h-8 rounded-lg" />
            </div>
            <div>
              <h1 className="font-bold text-lg text-white tracking-tight">{t('app.title')}</h1>
              <p className="text-xs text-gray-400 mt-0.5">{t('app.subtitle')}</p>
            </div>
          </div>
          <button
            onClick={onOpenSettings}
            aria-label={t('sidebar.settings')}
            className="p-2 rounded-lg hover:bg-white/5 hover:text-white text-gray-400 transition-all duration-200 border border-transparent hover:border-gray-700/50 group focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          >
            <Settings className="w-5 h-5 group-hover:rotate-90 transition-transform duration-300" />
          </button>
        </div>
      </div>

      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-3 space-y-2 relative z-10">
        {servers.length > 0 && (
          <div className="px-2 mb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                <Server className="w-3 h-3" />
                {t('sidebar.servers')} ({servers.length})
              </div>
              {onPingAll && (
                <button
                  onClick={handlePingAll}
                  disabled={isPinging || isConnected}
                  className={clsx(
                    'p-1.5 rounded-lg transition-all duration-200',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                    isPinging || isConnected
                      ? 'text-gray-600 cursor-not-allowed'
                      : 'text-gray-400 hover:text-white hover:bg-white/5 border border-transparent hover:border-gray-700/50'
                  )}
                  title={t('sidebar.pingAll')}
                >
                  <RefreshCw className={clsx('w-3.5 h-3.5', isPinging && 'animate-spin')} />
                </button>
              )}
            </div>
          </div>
        )}

        {subscriptionGroups.map(({ subscription, servers: subServers }) => (
          <ServerGroup
            key={subscription.id}
            title={subscription.name}
            color={getSubscriptionColor(subscription.id)}
            servers={subServers}
            selectedServer={selectedServer}
            isConnected={isConnected}
            onSelectServer={onSelectServer}
          />
        ))}

        {orphanSubscriptionServers.length > 0 && (
          <ServerGroup
            title={t('sidebar.subscriptionShort')}
            color={ORPHAN_GROUP_COLOR}
            servers={orphanSubscriptionServers}
            selectedServer={selectedServer}
            isConnected={isConnected}
            onSelectServer={onSelectServer}
            collapsible={false}
          />
        )}

        {manualServers.length > 0 && (
          <ServerGroup
            title={t('sidebar.manualShort')}
            color={MANUAL_GROUP_COLOR}
            servers={manualServers}
            selectedServer={selectedServer}
            isConnected={isConnected}
            onSelectServer={onSelectServer}
          />
        )}

        {servers.length === 0 && (
          <div className="flex flex-col items-center justify-center p-8 text-center">
            <div className="p-4 rounded-xl bg-gray-800/30 border border-gray-700/30 mb-4">
              <Server className="w-8 h-8 text-gray-500" />
            </div>
            <p className="text-gray-400 text-sm font-medium mb-1">{t('sidebar.noServers')}</p>
          </div>
        )}
      </div>

      <div className="relative z-10 p-4 border-t border-gray-800/50 bg-linear-to-r from-surface to-surface/95 backdrop-blur-sm">
        <div className="flex items-center justify-between">
          {appVersion && (
            <div className="text-xs text-gray-500 font-medium">
              v{appVersion}
            </div>
          )}
          {isConnected && (
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse shadow-lg shadow-green-500/50" />
              <span className="text-xs text-green-400 font-medium">{t('sidebar.connected')}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
