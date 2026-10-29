import React, { useEffect, useState } from 'react';
import { AlertTriangle, Code, Download, Tag } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { BUNDLED_XRAY_VERSION } from '@/shared/constants';
import { useUpdateStatus } from '@/renderer/hooks/useUpdateStatus';
import {
  Button,
  Page,
  Panel,
  Row,
  RowGroup,
  StatusPill,
  Tile,
} from '@/renderer/components/ui';

const REPO_URL = 'https://github.com/sliva-name/ultimaVLESS';

/** «О программе»: installed version, the update and the source code. */
export const AboutPage: React.FC = () => {
  const { t } = useTranslation();
  const { status: update, installUpdate } = useUpdateStatus();
  const [appVersion, setAppVersion] = useState('');
  const [installFailed, setInstallFailed] = useState(false);
  const version = update?.version ?? '';

  useEffect(() => {
    let disposed = false;
    window.electronAPI
      .getAppVersion()
      .then((next) => {
        if (!disposed) setAppVersion(next);
      })
      .catch((err) => console.error('Failed to read the app version:', err));
    return () => {
      disposed = true;
    };
  }, []);

  const updateRow = (() => {
    switch (update?.stage) {
      case 'downloaded':
        return (
          <Row
            tile={<Tile icon={Download} tone="info" />}
            label={t('pages.about.updateReady', { version })}
            hint={
              installFailed
                ? t('status.update.installFailed')
                : t('pages.about.updateReadyHint')
            }
            hintTone={installFailed ? 'warn' : undefined}
            trailing={
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  setInstallFailed(false);
                  installUpdate().catch((error: unknown) => {
                    console.error('Failed to install update', error);
                    setInstallFailed(true);
                  });
                }}
              >
                {t('status.update.restart')}
              </Button>
            }
          />
        );
      case 'downloading':
        return (
          <Row
            tile={<Tile icon={Download} tone="info" />}
            label={t('pages.about.updateDownloading', { version })}
            trailing={
              <StatusPill tone="info">
                {Math.round(update.percent ?? 0)} %
              </StatusPill>
            }
          />
        );
      case 'available':
        return (
          <Row
            tile={<Tile icon={Download} tone="info" />}
            label={t('pages.about.updateAvailable', { version })}
          />
        );
      case 'error':
        return (
          <Row
            tile={<Tile icon={AlertTriangle} tone="warn" />}
            label={t('status.update.error')}
            hint={update.error ?? undefined}
          />
        );
      default:
        return null;
    }
  })();

  return (
    <Page title={t('pages.about.title')} lead={t('pages.about.lead')}>
      <Panel title={t('app.title')}>
        <RowGroup>
          <Row
            tile={<Tile icon={Tag} />}
            label={t('pages.about.installedVersion')}
            hint={`Xray ${BUNDLED_XRAY_VERSION.replace(/^v/, '')}`}
            trailing={
              appVersion ? (
                <StatusPill tone="plain">{appVersion}</StatusPill>
              ) : null
            }
          />
          {updateRow}
          <Row
            tile={<Tile icon={Code} />}
            label={t('pages.about.sourceCode')}
            hint={`${REPO_URL.replace(/^https:\/\//, '')} · MIT`}
            trailing={
              <Button
                size="sm"
                onClick={() =>
                  void window.electronAPI.openExternalUrl(REPO_URL)
                }
              >
                {t('pages.about.open')}
              </Button>
            }
          />
        </RowGroup>
      </Panel>
    </Page>
  );
};
