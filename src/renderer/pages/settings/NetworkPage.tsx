import React, { useMemo } from 'react';
import { RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { NetworkAdapterView } from '@/shared/ipc';
import type { ConnectionMode, PingMethod } from '@/shared/types';
import { localizeError } from '@/shared/localizeError';
import type { NetworkSettings } from '@/renderer/hooks/useNetworkSettings';
import { useAppSnapshotContext } from '@/renderer/hooks/useAppSnapshot';
import {
  ChoiceCards,
  ErrorText,
  Foot,
  IconButton,
  Notice,
  Panel,
  Row,
  RowGroup,
  Select,
  Toggle,
  type SelectOption,
} from '@/renderer/components/ui';
import { DraftPage, useSettingsLock } from './DraftPage';

interface NetworkPageProps {
  net: NetworkSettings;
  onModeChange: (mode: ConnectionMode) => void;
}

/** «Режим и сеть»: proxy or TUN, the TUN adapter and the ping method. */
export const NetworkPage: React.FC<NetworkPageProps> = ({
  net,
  onModeChange,
}) => {
  const { t, i18n } = useTranslation();
  const { isConnectionBusy } = useAppSnapshotContext();
  const locked = useSettingsLock();
  const {
    connectionMode,
    tunCapability,
    modeError,
    perfSettings,
    updatePerfField,
    adapterList,
    adaptersLoading,
    adaptersError,
    refreshAdapters,
  } = net;

  const selectedAdapterName = perfSettings.tunOutboundInterface;
  const adapters = useMemo(() => adapterList?.adapters ?? [], [adapterList]);
  const selectedAdapter = adapters.find(
    (adapter) => adapter.name === selectedAdapterName,
  );
  const adapterOptions = useMemo(
    () => buildAdapterOptions(adapters, selectedAdapterName, t),
    [adapters, selectedAdapterName, t],
  );

  const tunUnavailable = !!tunCapability && !tunCapability.supported;
  const tunNeedsPrivileges =
    !!tunCapability && tunCapability.supported && !tunCapability.hasPrivileges;
  const windowsTun =
    tunCapability?.platform === 'win32' && tunCapability.supported;

  return (
    <DraftPage
      net={net}
      title={t('pages.network.title')}
      lead={t('pages.network.lead')}
      lockText={t('settings.network.performanceLocked')}
    >
      <Panel
        title={t('settings.network.mode')}
        note={t('pages.network.modeNote')}
        foot={
          <>
            <Foot>{t('settings.network.modeReconnectHint')}</Foot>
            {tunUnavailable && (
              <Foot tone="warn">
                {tunCapability?.platform === 'darwin'
                  ? t('settings.network.tunUnsupportedDarwin')
                  : t('settings.network.tunUnavailable')}
              </Foot>
            )}
            {tunNeedsPrivileges && !windowsTun && (
              <Foot tone="warn">{t('settings.network.tunElevated')}</Foot>
            )}
            {!windowsTun && tunCapability?.routeMode && (
              <Foot>
                {t('settings.network.routingMode', {
                  mode: tunCapability.routeMode,
                })}
              </Foot>
            )}
            {tunCapability?.degradedReason && (
              <Foot tone="warn">
                {tunCapability.platform === 'linux'
                  ? t('settings.network.tunDegradedLinux')
                  : tunCapability.degradedReason}
              </Foot>
            )}
            {modeError && (
              <ErrorText>{localizeError(modeError, i18n.language)}</ErrorText>
            )}
          </>
        }
      >
        <ChoiceCards<ConnectionMode>
          label={t('settings.network.mode')}
          value={connectionMode}
          onChange={onModeChange}
          // A connected session reconnects in the picked mode; only in-flight work locks.
          disabled={isConnectionBusy}
          isDisabled={(mode) => mode === 'tun' && tunUnavailable}
          options={[
            {
              value: 'proxy',
              label: t('settings.network.proxyMode'),
              desc: t('settings.network.proxyDesc'),
            },
            {
              value: 'tun',
              label: t('settings.network.tunMode'),
              desc: t('settings.network.tunDesc'),
            },
          ]}
        />
      </Panel>

      {windowsTun && (
        <Panel
          title={t('pages.network.tunWindows')}
          note={t('pages.nextConnection')}
          locked={locked}
          foot={
            <>
              {selectedAdapterName && adapterList && !selectedAdapter && (
                <Foot tone="warn">
                  {t('settings.network.tunAdapterMissingWarning', {
                    name: selectedAdapterName,
                  })}
                </Foot>
              )}
              {selectedAdapter && selectedAdapter.gateway === null && (
                <Foot tone="warn">
                  {t('settings.network.tunAdapterNoGatewayWarning', {
                    name: selectedAdapter.name,
                  })}
                </Foot>
              )}
              {adaptersError && (
                <Foot tone="warn">
                  {t('settings.network.tunAdapterLoadFailed', {
                    error: localizeError(adaptersError, i18n.language),
                  })}
                </Foot>
              )}
              {tunCapability?.routeMode && (
                <Foot>
                  {t('settings.network.routingMode', {
                    mode: tunCapability.routeMode,
                  })}
                </Foot>
              )}
              <Foot>{t('settings.network.windowsTunApplyHint')}</Foot>
            </>
          }
        >
          {tunNeedsPrivileges && (
            <Notice tone="info">
              {t('settings.network.tunElevated_win32')}
            </Notice>
          )}
          <RowGroup>
            <Row
              label={t('settings.network.tunBlockDnsLeaks')}
              hint={t('settings.network.tunBlockDnsLeaksHint')}
              trailing={
                <Toggle
                  checked={perfSettings.tunBlockDnsLeaks}
                  onChange={(v) => updatePerfField('tunBlockDnsLeaks', v)}
                  ariaLabel={t('settings.network.tunBlockDnsLeaks')}
                />
              }
            />
            <Row
              label={t('settings.network.tunAdapter')}
              hint={t('settings.network.tunAdapterHint')}
              trailing={
                <div className="flex shrink-0 items-center gap-1">
                  <Select
                    value={selectedAdapterName}
                    onChange={(v) => updatePerfField('tunOutboundInterface', v)}
                    options={adapterOptions}
                    ariaLabel={t('settings.network.tunAdapter')}
                    showDescription
                  />
                  <IconButton
                    icon={RefreshCw}
                    label={t('settings.network.tunAdapterRefresh')}
                    onClick={() => void refreshAdapters()}
                    disabled={adaptersLoading}
                  />
                </div>
              }
            />
          </RowGroup>
        </Panel>
      )}

      <Panel
        title={t('settings.network.pingMethod')}
        note={t('pages.nextConnection')}
        locked={locked}
        foot={<Foot>{t('settings.network.pingMethodHint')}</Foot>}
      >
        <ChoiceCards<PingMethod>
          label={t('settings.network.pingMethod')}
          value={perfSettings.pingMethod}
          onChange={(v) => updatePerfField('pingMethod', v)}
          disabled={locked}
          options={[
            {
              value: 'real',
              label: t('settings.network.pingMethodReal'),
              desc: t('settings.network.pingMethodRealDesc'),
            },
            {
              value: 'tcp',
              label: t('settings.network.pingMethodTcp'),
              desc: t('settings.network.pingMethodTcpDesc'),
            },
          ]}
        />
      </Panel>
    </DraftPage>
  );
};

function describeAdapter(adapter: NetworkAdapterView, t: TFunction): string {
  return [
    adapter.description,
    adapter.ipv4.join(', '),
    adapter.gateway
      ? t('settings.network.tunAdapterGateway', { gateway: adapter.gateway })
      : t('settings.network.tunAdapterNoGateway'),
    adapter.kind === 'vpn'
      ? t('settings.network.tunAdapterKindVpn')
      : adapter.kind === 'virtual'
        ? t('settings.network.tunAdapterKindVirtual')
        : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** "Automatic" first, then live adapters, then a stale saved choice. */
function buildAdapterOptions(
  adapters: NetworkAdapterView[],
  selectedName: string,
  t: TFunction,
): SelectOption[] {
  const automatic = adapters.find((adapter) => adapter.isAutomaticChoice);
  const options: SelectOption[] = [
    {
      value: '',
      label: t('settings.network.tunAdapterAuto'),
      description: automatic
        ? t('settings.network.tunAdapterAutoDesc', { name: automatic.name })
        : t('settings.network.tunAdapterAutoNone'),
    },
    ...adapters.map((adapter) => ({
      value: adapter.name,
      label: adapter.name,
      description: describeAdapter(adapter, t),
    })),
  ];
  if (selectedName && !adapters.some((a) => a.name === selectedName)) {
    options.push({
      value: selectedName,
      label: selectedName,
      description: t('settings.network.tunAdapterMissing'),
    });
  }
  return options;
}
