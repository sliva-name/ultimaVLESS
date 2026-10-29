import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { localizeError } from '@/shared/localizeError';
import { useAppSnapshotContext } from '@/renderer/hooks/useAppSnapshot';
import type { NetworkSettings } from '@/renderer/hooks/useNetworkSettings';
import { countChanges } from '@/renderer/settingsModel';
import { ErrorText, LockBanner, Page, SaveBar } from '@/renderer/components/ui';

interface DraftPageProps {
  net: NetworkSettings;
  title: string;
  lead?: string;
  /** The read-only notice while a session runs. */
  lockText: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}

/** Network, DNS, core and routing: one draft, saved together. */
export function useSettingsLock() {
  const { isConnected, isConnectionBusy } = useAppSnapshotContext();
  return isConnected || isConnectionBusy;
}

/**
 * Page over the shared network-settings draft: the lock notice while
 * connected and one save bar for every unsaved change across these pages.
 */
export const DraftPage: React.FC<DraftPageProps> = ({
  net,
  title,
  lead,
  lockText,
  actions,
  children,
}) => {
  const { i18n, t } = useTranslation();
  const { snapshot, toggleConnection } = useAppSnapshotContext();
  const locked = useSettingsLock();
  const [saveError, setSaveError] = useState<string | null>(null);
  const changes = countChanges(net.perfSettings, net.perfBaseline);

  const save = useCallback(async () => {
    setSaveError(null);
    try {
      await net.savePerfSettings();
    } catch (err) {
      console.error('Failed to save performance settings:', err);
      setSaveError(
        err instanceof Error
          ? err.message
          : t('settings.network.savePerfFailed'),
      );
    }
  }, [net, t]);

  return (
    <Page
      title={title}
      lead={lead}
      actions={actions}
      banner={
        <>
          {locked && (
            <LockBanner
              text={lockText}
              onDisconnect={() => void toggleConnection()}
              disconnectDisabled={snapshot.session.phase === 'disconnecting'}
            />
          )}
          {saveError && (
            <ErrorText>{localizeError(saveError, i18n.language)}</ErrorText>
          )}
        </>
      }
      footer={
        net.perfDirty && changes > 0 && !locked ? (
          <SaveBar
            changes={changes}
            saving={net.perfSaving}
            onDiscard={() => {
              setSaveError(null);
              net.revertPerfSettings();
            }}
            onSave={() => void save()}
          />
        ) : null
      }
    >
      {children}
    </Page>
  );
};
