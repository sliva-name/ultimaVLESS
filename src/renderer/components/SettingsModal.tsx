import React, { useState } from 'react';
import clsx from 'clsx';
import { Shield, X, Layers, Activity } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Subscription, VlessConfig } from '@/shared/types';
import { useSettingsMonitor } from '@/renderer/hooks/useSettingsMonitor';
import { SettingsSourcesTab } from './settings/SettingsSourcesTab';
import { SettingsNetworkTab } from './settings/SettingsNetworkTab';
import { SettingsDiagnosticsTab } from './settings/SettingsDiagnosticsTab';

interface SettingsModalProps {
  isOpen: boolean;
  servers: VlessConfig[];
  subscriptions: Subscription[];
  isConnected: boolean;
  isConnectionBusy: boolean;
  onClose: () => void;
}

type SettingsTabId = 'sources' | 'network' | 'diagnostics';

const SETTINGS_TABS: { id: SettingsTabId; labelKey: string; icon: typeof Layers }[] = [
  { id: 'sources', labelKey: 'settings.tabs.sources', icon: Layers },
  { id: 'network', labelKey: 'settings.tabs.network', icon: Shield },
  { id: 'diagnostics', labelKey: 'settings.tabs.diagnostics', icon: Activity },
];

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  servers,
  subscriptions,
  isConnected,
  isConnectionBusy,
  onClose,
}) => {
  const { t, i18n } = useTranslation();
  const [activeTab, setActiveTab] = useState<SettingsTabId>('sources');

  const {
    monitorStatus,
    recentEvents,
    autoSwitching,
    hasLoadedMonitorStatus,
    setAutoSwitching,
    loadMonitorStatus,
  } = useSettingsMonitor({ isOpen });

  if (!isOpen) return null;

  return (
    <div className="flex-1 flex flex-col items-stretch sm:items-center justify-center p-3 sm:p-4 md:p-6 animate-[fadeIn_0.3s_ease-out] min-h-0 min-w-0 overflow-hidden">
      <div className="w-full max-w-2xl max-h-[min(85dvh,760px)] min-h-0 bg-linear-to-br from-surface via-surface to-surface/95 backdrop-blur-xl rounded-2xl border border-gray-700/50 shadow-2xl shadow-black/50 relative overflow-hidden flex flex-col mx-auto">
        <div className="absolute inset-0 bg-linear-to-br from-primary/5 via-transparent to-transparent pointer-events-none z-0" />

        <header className="relative z-10 shrink-0 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between px-4 sm:px-6 pt-4 sm:pt-5 pb-3 border-b border-gray-800/50">
          <div className="min-w-0">
            <h2 className="text-lg sm:text-xl font-semibold text-white tracking-tight">{t('settings.title')}</h2>
            <p className="text-xs text-gray-400 mt-1 leading-relaxed max-w-md">{t('settings.subtitle')}</p>
          </div>
          <div className="flex items-center gap-2 self-end sm:self-center mt-2 sm:mt-0">
            <div className="flex bg-black/40 border border-gray-700/50 rounded-xl p-1">
              <LanguageButton
                code="ru"
                active={i18n.language === 'ru'}
                onSelect={() => i18n.changeLanguage('ru')}
              />
              <LanguageButton
                code="en"
                active={i18n.language.startsWith('en')}
                onSelect={() => i18n.changeLanguage('en')}
              />
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl p-2.5 text-gray-400 hover:text-white hover:bg-white/5 border border-transparent hover:border-gray-700/50 transition-colors"
              aria-label={t('settings.close')}
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </header>

        <nav
          className="relative z-10 shrink-0 px-3 sm:px-6 py-2 flex gap-1.5 overflow-x-auto"
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
                  : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'
              )}
            >
              <Icon className="w-4 h-4 opacity-90" />
              {t(labelKey)}
            </button>
          ))}
        </nav>

        <div className="flex-1 min-h-0 overflow-y-auto relative z-10 px-4 sm:px-6 py-4 sm:py-5 pb-6 text-sm leading-relaxed">
          {activeTab === 'sources' && (
            <SettingsSourcesTab
              subscriptions={subscriptions}
              isOpen={isOpen}
            />
          )}

          {activeTab === 'network' && (
            <SettingsNetworkTab
              isOpen={isOpen}
              isConnected={isConnected}
              isConnectionBusy={isConnectionBusy}
              hasLoadedMonitorStatus={hasLoadedMonitorStatus}
              monitorIsConnected={!!monitorStatus?.isConnected}
            />
          )}

          {activeTab === 'diagnostics' && (
            <SettingsDiagnosticsTab
              servers={servers}
              monitorStatus={monitorStatus}
              recentEvents={recentEvents}
              autoSwitching={autoSwitching}
              onAutoSwitchingChange={setAutoSwitching}
              onReloadMonitorStatus={loadMonitorStatus}
            />
          )}
        </div>
      </div>
    </div>
  );
};

interface LanguageButtonProps {
  code: 'ru' | 'en';
  active: boolean;
  onSelect: () => void;
}

const LanguageButton: React.FC<LanguageButtonProps> = ({ code, active, onSelect }) => (
  <button
    type="button"
    onClick={onSelect}
    className={clsx(
      'px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors',
      active ? 'bg-primary/20 text-white' : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'
    )}
  >
    {code.toUpperCase()}
  </button>
);
