import React, { useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { localizeError } from '@/shared/localizeError';
import {
  AppSnapshotProvider,
  useAppSnapshotContext,
} from './hooks/useAppSnapshot';
import { useNetworkSettings } from './hooks/useNetworkSettings';
import { useModeChange } from './hooks/useModeChange';
import { useUpdateStatus } from './hooks/useUpdateStatus';
import { useTheme } from './hooks/useTheme';
import { TitleBar } from './components/shell/TitleBar';
import { Rail, type Section } from './components/shell/Rail';
import { HomePage } from './pages/HomePage';
import { RoutingPage } from './pages/RoutingPage';
import { SubscriptionsPage } from './pages/SubscriptionsPage';
import { DiagnosticsPage } from './pages/DiagnosticsPage';
import {
  SettingsSection,
  type SettingsPageId,
} from './pages/settings/SettingsSection';

function AppShell() {
  const { t, i18n } = useTranslation();
  const { snapshot, isConnected, isConnectionBusy } = useAppSnapshotContext();
  const [section, setSection] = useState<Section>('home');
  const [settingsPage, setSettingsPage] = useState<SettingsPageId>('network');
  // Settings load when a settings-like section opens; unsaved edits live
  // across those sections and are dropped on the way back home.
  const net = useNetworkSettings(section !== 'home');
  const changeMode = useModeChange(net, isConnectionBusy);
  const { status: update, installUpdate } = useUpdateStatus();
  const theme = useTheme();
  const showModeError =
    !!net.modeError && !(section === 'settings' && settingsPage === 'network');

  return (
    <div className="h-screen min-h-0 flex flex-col bg-canvas text-fg overflow-hidden">
      <TitleBar
        mode={net.connectionMode}
        modeDisabled={isConnectionBusy}
        onMode={(mode) => void changeMode(mode)}
        update={update}
        onInstallUpdate={installUpdate}
      />
      {showModeError && net.modeError && (
        <div
          role="alert"
          className="shrink-0 flex items-center gap-2.5 py-1.5 pl-4 pr-2 bg-warn-soft border-b border-warn-line"
        >
          <AlertTriangle
            aria-hidden
            strokeWidth={2}
            className="w-4 h-4 shrink-0 text-warn"
          />
          <span className="flex-1 min-w-0 text-xs leading-4 text-fg break-words">
            {localizeError(net.modeError, i18n.language)}
          </span>
          <button
            type="button"
            onClick={() => net.setModeError(null)}
            aria-label={t('conflicts.dismiss')}
            title={t('conflicts.dismiss')}
            className="shrink-0 w-6 h-6 inline-flex items-center justify-center rounded-md text-fg3 hover:bg-s3 hover:text-fg"
          >
            <X aria-hidden className="w-4 h-4" />
          </button>
        </div>
      )}
      <div className="flex-1 min-h-0 flex">
        <Rail
          active={section}
          onNavigate={setSection}
          connected={isConnected}
          diagAlert={snapshot.session.phase === 'failed'}
        />
        {section === 'home' && (
          <HomePage
            onNavigate={setSection}
            onModeChange={(mode) => void changeMode(mode)}
          />
        )}
        {section === 'routing' && <RoutingPage net={net} />}
        {section === 'subs' && <SubscriptionsPage />}
        {section === 'settings' && (
          <SettingsSection
            page={settingsPage}
            onPage={setSettingsPage}
            net={net}
            onModeChange={(mode) => void changeMode(mode)}
            theme={theme}
          />
        )}
        {section === 'diag' && <DiagnosticsPage />}
      </div>
    </div>
  );
}

function App() {
  return (
    <AppSnapshotProvider>
      <AppShell />
    </AppSnapshotProvider>
  );
}

export default App;
