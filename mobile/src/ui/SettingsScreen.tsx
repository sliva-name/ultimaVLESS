import React, { useState } from 'react';
import clsx from 'clsx';
import { Activity, Layers, Shield } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Subscription, VlessConfig } from '@/shared/types';
import { useSettingsMonitor } from '@/renderer/hooks/useSettingsMonitor';
import { useAppSnapshot } from '@/renderer/hooks/useAppSnapshot';
import { SettingsSourcesTab } from '@/renderer/components/settings/SettingsSourcesTab';
import { SettingsNetworkTab } from '@/renderer/components/settings/SettingsNetworkTab';
import { SettingsDiagnosticsTab } from '@/renderer/components/settings/SettingsDiagnosticsTab';

type SettingsTabId = 'sources' | 'network' | 'diagnostics';

const SETTINGS_TABS: {
  id: SettingsTabId;
  labelKey: string;
  icon: typeof Layers;
}[] = [
  { id: 'sources', labelKey: 'settings.tabs.sources', icon: Layers },
  { id: 'network', labelKey: 'settings.tabs.network', icon: Shield },
  { id: 'diagnostics', labelKey: 'settings.tabs.diagnostics', icon: Activity },
];

interface SettingsScreenProps {
  servers: VlessConfig[];
  subscriptions: Subscription[];
  isConnected: boolean;
  isConnectionBusy: boolean;
}

/** The desktop settings dialog's tabs as a full screen. */
export const SettingsScreen: React.FC<SettingsScreenProps> = ({
  servers,
  subscriptions,
  isConnected,
  isConnectionBusy,
}) => {
  const { t, i18n } = useTranslation();
  const [activeTab, setActiveTab] = useState<SettingsTabId>('sources');
  const snapshot = useAppSnapshot();
  const { recentEvents } = useSettingsMonitor({ isOpen: true });

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <header className="mobile-top-bar shrink-0 flex items-center justify-between gap-3 px-4 pb-2">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-white tracking-tight">
            {t('settings.title')}
          </h2>
          <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">
            {t('settings.subtitle')}
          </p>
        </div>
        <div className="flex shrink-0 bg-black/40 border border-gray-700/50 rounded-xl p-1">
          {(['ru', 'en'] as const).map((code) => {
            const active =
              code === 'ru'
                ? i18n.language === 'ru'
                : i18n.language.startsWith('en');
            return (
              <button
                key={code}
                type="button"
                onClick={() => void i18n.changeLanguage(code)}
                className={clsx(
                  'px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors',
                  active ? 'bg-primary/20 text-white' : 'text-gray-400',
                )}
              >
                {code.toUpperCase()}
              </button>
            );
          })}
        </div>
      </header>

      <nav
        className="shrink-0 px-3 py-2 flex gap-1.5 overflow-x-auto border-b border-gray-800/50"
        role="tablist"
        aria-label={t('settings.navAria')}
      >
        {SETTINGS_TABS.map(({ id, labelKey, icon: Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={activeTab === id}
            onClick={() => setActiveTab(id)}
            className={clsx(
              'shrink-0 flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-colors border border-transparent whitespace-nowrap',
              activeTab === id
                ? 'bg-primary/15 text-white border-primary/30'
                : 'text-gray-400 active:bg-white/5',
            )}
          >
            <Icon className="w-4 h-4 opacity-90" />
            {t(labelKey)}
          </button>
        ))}
      </nav>

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-4 pb-8 text-sm leading-relaxed">
        {activeTab === 'sources' && (
          <SettingsSourcesTab subscriptions={subscriptions} isOpen />
        )}
        {activeTab === 'network' && (
          <SettingsNetworkTab
            isOpen
            isConnected={isConnected}
            isConnectionBusy={isConnectionBusy}
          />
        )}
        {activeTab === 'diagnostics' && (
          <SettingsDiagnosticsTab
            servers={servers}
            snapshot={snapshot}
            recentEvents={recentEvents}
          />
        )}
      </div>
    </div>
  );
};
