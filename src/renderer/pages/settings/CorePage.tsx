import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  DEFAULT_PERFORMANCE_SETTINGS,
  TUN_MTU_MAX,
  TUN_MTU_MIN,
  type DomainStrategy,
  type LogLevel,
  type PerformanceSettings,
  type TlsFingerprint,
  type XudpProxyUDP443,
} from '@/shared/types';
import type { NetworkSettings } from '@/renderer/hooks/useNetworkSettings';
import { CORE_FIELDS, FINGERPRINT_LABELS } from '@/renderer/settingsModel';
import {
  Button,
  NumberField,
  Panel,
  Row,
  RowGroup,
  Select,
  Toggle,
  type SelectOption,
} from '@/renderer/components/ui';
import { DraftPage, useSettingsLock } from './DraftPage';

type Field = keyof PerformanceSettings;

/** «Ядро Xray»: low-level Xray parameters, grouped as in the design. */
export const CorePage: React.FC<{ net: NetworkSettings }> = ({ net }) => {
  const { t } = useTranslation();
  const locked = useSettingsLock();
  const { perfSettings, updatePerfField } = net;

  const toggle = (field: Field & keyof PerformanceSettings, key: string) => (
    <Row
      label={t(`settings.network.${key}`)}
      hint={t(`settings.network.${key}Hint`)}
      trailing={
        <Toggle
          checked={perfSettings[field] as boolean}
          onChange={(v) =>
            updatePerfField(field, v as PerformanceSettings[typeof field])
          }
          ariaLabel={t(`settings.network.${key}`)}
        />
      }
    />
  );

  const number = (field: Field, key: string, min: number, max: number) => (
    <Row
      label={t(`settings.network.${key}`)}
      hint={t(`settings.network.${key}Hint`)}
      trailing={
        <NumberField
          label={t(`settings.network.${key}`)}
          value={perfSettings[field] as number}
          min={min}
          max={max}
          onChange={(v) =>
            updatePerfField(field, v as PerformanceSettings[typeof field])
          }
        />
      }
    />
  );

  const select = (field: Field, key: string, options: SelectOption[]) => (
    <Row
      label={t(`settings.network.${key}`)}
      hint={t(`settings.network.${key}Hint`)}
      trailing={
        <Select
          value={perfSettings[field] as string}
          onChange={(v) =>
            updatePerfField(field, v as PerformanceSettings[typeof field])
          }
          options={options}
          ariaLabel={t(`settings.network.${key}`)}
        />
      }
    />
  );

  // Puts this page's fields back as unsaved edits; routing and DNS stay.
  const resetCore = () => {
    for (const field of CORE_FIELDS) {
      updatePerfField(field, DEFAULT_PERFORMANCE_SETTINGS[field]);
    }
  };

  return (
    <DraftPage
      net={net}
      title={t('pages.core.title')}
      lead={t('settings.network.advancedHint')}
      lockText={t('settings.network.performanceLocked')}
      actions={
        <Button variant="danger" onClick={resetCore} disabled={locked}>
          {t('settings.network.resetDefaults')}
        </Button>
      }
    >
      <Panel
        title={t('pages.core.mux')}
        note={t('pages.nextConnection')}
        locked={locked}
      >
        <RowGroup>
          {toggle('muxEnabled', 'muxEnabled')}
          {perfSettings.muxEnabled &&
            number('muxConcurrency', 'muxConcurrency', 1, 128)}
          {number('xhttpMaxConnections', 'xhttpMaxConnections', 1, 16)}
        </RowGroup>
      </Panel>

      <Panel title={t('pages.core.udp')} locked={locked}>
        <RowGroup>
          {number('xudpConcurrency', 'xudpConcurrency', 1, 1024)}
          {select('xudpProxyUDP443', 'xudpProxyUDP443', [
            {
              value: 'reject' satisfies XudpProxyUDP443,
              label: t('settings.network.udp443Reject'),
              description: 'QUIC → TCP',
            },
            {
              value: 'allow' satisfies XudpProxyUDP443,
              label: t('settings.network.udp443Allow'),
              description: 'XUDP mux',
            },
            {
              value: 'skip' satisfies XudpProxyUDP443,
              label: t('settings.network.udp443Skip'),
              description: 'Native UDP',
            },
          ])}
        </RowGroup>
      </Panel>

      <Panel title={t('pages.core.transport')} locked={locked}>
        <RowGroup>
          {number('tunMtu', 'tunMtu', TUN_MTU_MIN, TUN_MTU_MAX)}
          {toggle('tcpFastOpen', 'tcpFastOpen')}
          {toggle('sniffingRouteOnly', 'sniffingRouteOnly')}
          {select(
            'domainStrategy',
            'domainStrategy',
            (['AsIs', 'IPIfNonMatch', 'IPOnDemand'] as DomainStrategy[]).map(
              (value) => ({ value, label: value }),
            ),
          )}
        </RowGroup>
      </Panel>

      <Panel title={t('pages.core.fingerprintLogs')} locked={locked}>
        <RowGroup>
          {select(
            'fingerprint',
            'fingerprint',
            (Object.keys(FINGERPRINT_LABELS) as TlsFingerprint[]).map(
              (value) => ({ value, label: FINGERPRINT_LABELS[value] }),
            ),
          )}
          {select(
            'logLevel',
            'logLevel',
            (['debug', 'info', 'warning', 'error', 'none'] as LogLevel[]).map(
              (value) => ({ value, label: value }),
            ),
          )}
        </RowGroup>
      </Panel>
    </DraftPage>
  );
};
