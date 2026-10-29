import React, { useState } from 'react';
import { AlertTriangle, Code, Download, Tag } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { UpdateStatus } from '@/shared/ipc';
import { BUNDLED_XRAY_VERSION } from '@/shared/constants';
import {
  Foot,
  NavChevron,
  PageBody,
  Panel,
  Pill,
  Row,
  RowGroup,
  Tile,
} from './kit';

const REPO_URL = 'https://github.com/sliva-name/ultimaVLESS';

interface AboutPageProps {
  appVersion: string;
  update: UpdateStatus | null;
  installUpdate: () => Promise<boolean>;
}

/** Installed version, the background update and the source code. */
export const AboutPage: React.FC<AboutPageProps> = ({
  appVersion,
  update,
  installUpdate,
}) => {
  const { t } = useTranslation();
  const [installFailed, setInstallFailed] = useState(false);
  const version = update?.version ?? '';

  const updateRow = (() => {
    if (!update) return null;
    switch (update.stage) {
      case 'downloaded':
        return (
          <Row
            tile={<Tile icon={Download} tone="info" />}
            label={t('mobile.update.ready', { version })}
            hint={
              installFailed
                ? t('status.update.installFailed')
                : t('mobile.update.installHint')
            }
            hintTone={installFailed ? 'warn' : undefined}
            wrap
            trailing={
              <button
                type="button"
                onClick={() => {
                  setInstallFailed(false);
                  installUpdate().catch((error: unknown) => {
                    console.error('Failed to install update', error);
                    setInstallFailed(true);
                  });
                }}
                className="shrink-0 h-9 px-3.5 rounded-[10px] bg-acc-fill text-white text-sm leading-4 font-medium whitespace-nowrap"
              >
                {t('mobile.update.install')}
              </button>
            }
          />
        );
      case 'downloading':
        return (
          <Row
            tile={<Tile icon={Download} tone="info" />}
            label={t('mobile.update.downloading', {
              version,
              percent: Math.round(update.percent ?? 0),
            })}
            wrap
          />
        );
      case 'available':
        return (
          <Row
            tile={<Tile icon={Download} tone="info" />}
            label={t('mobile.update.available', { version })}
            wrap
          />
        );
      case 'error':
        return (
          <Row
            tile={<Tile icon={AlertTriangle} tone="warn" />}
            label={t('status.update.error')}
            hint={update.error ?? undefined}
            wrap
          />
        );
      default:
        return null;
    }
  })();

  return (
    <PageBody>
      <Panel
        title={t('mobile.settings.aboutTitle')}
        foot={<Foot>{t('mobile.settings.updatesNote')}</Foot>}
      >
        <RowGroup>
          <Row
            tile={<Tile icon={Tag} />}
            label={t('mobile.settings.installedVersion')}
            hint={`Xray ${BUNDLED_XRAY_VERSION.replace(/^v/, '')}`}
            trailing={
              appVersion ? <Pill tone="plain">{appVersion}</Pill> : null
            }
          />
          {updateRow}
          <Row
            tile={<Tile icon={Code} />}
            label={t('mobile.settings.sourceCode')}
            hint={`${REPO_URL.replace(/^https:\/\//, '')} · MIT`}
            trailing={<NavChevron />}
            onClick={() => {
              window.electronAPI
                .openExternalUrl(REPO_URL)
                .catch((error: unknown) => {
                  console.error('Failed to open the repository', error);
                });
            }}
          />
        </RowGroup>
      </Panel>
    </PageBody>
  );
};
