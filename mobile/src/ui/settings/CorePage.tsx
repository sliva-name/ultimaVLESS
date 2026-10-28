import React from 'react';
import { RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  DEFAULT_PERFORMANCE_SETTINGS,
  type DomainStrategy,
  type LogLevel,
  type TlsFingerprint,
  type XudpProxyUDP443,
} from '@/shared/types';
import type { useNetworkSettings } from '@/renderer/hooks/useNetworkSettings';
import {
  CORE_FIELDS,
  DOMAIN_STRATEGY_OPTIONS,
  FINGERPRINT_OPTIONS,
  LOG_LEVEL_OPTIONS,
  udp443Options,
} from './options';
import {
  NumberRow,
  PageBody,
  Panel,
  RowGroup,
  SelectRow,
  SwitchRow,
  WideButton,
} from './kit';

type NetworkSettings = ReturnType<typeof useNetworkSettings>;

/**
 * Low-level Xray parameters. TCP Fast Open is not offered: Android forces
 * it off (see `planAndroidRouting`).
 */
export const CorePage: React.FC<{ net: NetworkSettings; locked: boolean }> = ({
  net,
  locked,
}) => {
  const { t } = useTranslation();
  const { perfSettings: settings, updatePerfField: update } = net;

  // Puts this screen's fields back to their defaults as unsaved edits, so
  // the save bar can still keep or undo them.
  const resetCore = () => {
    for (const key of CORE_FIELDS) {
      update(key, DEFAULT_PERFORMANCE_SETTINGS[key]);
    }
  };

  return (
    <PageBody lead={t('settings.network.advancedHint')}>
      <Panel
        title={t('mobile.settings.mux')}
        note={t('mobile.settings.nextConnection')}
        locked={locked}
      >
        <RowGroup>
          <SwitchRow
            label={t('settings.network.muxEnabled')}
            hint={t('settings.network.muxEnabledHint')}
            checked={settings.muxEnabled}
            onChange={(value) => update('muxEnabled', value)}
          />
          {settings.muxEnabled && (
            <NumberRow
              label={t('settings.network.muxConcurrency')}
              hint={t('settings.network.muxConcurrencyHint')}
              value={settings.muxConcurrency}
              min={1}
              max={128}
              onChange={(value) => update('muxConcurrency', value)}
            />
          )}
          <NumberRow
            label={t('settings.network.xhttpMaxConnections')}
            hint={t('settings.network.xhttpMaxConnectionsHint')}
            value={settings.xhttpMaxConnections}
            min={1}
            max={16}
            onChange={(value) => update('xhttpMaxConnections', value)}
          />
        </RowGroup>
      </Panel>

      <Panel title={t('mobile.settings.udp')} locked={locked}>
        <RowGroup>
          <NumberRow
            label={t('settings.network.xudpConcurrency')}
            hint={t('settings.network.xudpConcurrencyHint')}
            value={settings.xudpConcurrency}
            min={1}
            max={1024}
            onChange={(value) => update('xudpConcurrency', value)}
          />
          <SelectRow
            label={t('settings.network.xudpProxyUDP443')}
            hint={t('settings.network.xudpProxyUDP443Hint')}
            value={settings.xudpProxyUDP443}
            options={udp443Options(t)}
            onChange={(value) =>
              update('xudpProxyUDP443', value as XudpProxyUDP443)
            }
          />
        </RowGroup>
      </Panel>

      <Panel title={t('mobile.settings.transport')} locked={locked}>
        <RowGroup>
          <SwitchRow
            label={t('settings.network.sniffingRouteOnly')}
            hint={t('settings.network.sniffingRouteOnlyHint')}
            checked={settings.sniffingRouteOnly}
            onChange={(value) => update('sniffingRouteOnly', value)}
          />
          <SelectRow
            label={t('settings.network.domainStrategy')}
            hint={t('settings.network.domainStrategyHint')}
            value={settings.domainStrategy}
            options={DOMAIN_STRATEGY_OPTIONS}
            onChange={(value) =>
              update('domainStrategy', value as DomainStrategy)
            }
          />
        </RowGroup>
      </Panel>

      <Panel title={t('mobile.settings.fingerprintLogs')} locked={locked}>
        <RowGroup>
          <SelectRow
            label={t('settings.network.fingerprint')}
            hint={t('settings.network.fingerprintHint')}
            value={settings.fingerprint}
            options={FINGERPRINT_OPTIONS}
            onChange={(value) => update('fingerprint', value as TlsFingerprint)}
          />
          <SelectRow
            label={t('settings.network.logLevel')}
            hint={t('settings.network.logLevelHint')}
            value={settings.logLevel}
            options={LOG_LEVEL_OPTIONS}
            onChange={(value) => update('logLevel', value as LogLevel)}
          />
        </RowGroup>
        <WideButton
          icon={RotateCcw}
          tone="bad"
          onClick={resetCore}
          disabled={locked}
        >
          {t('settings.network.resetDefaults')}
        </WideButton>
      </Panel>
    </PageBody>
  );
};
