import React, { useMemo } from 'react';
import clsx from 'clsx';
import { LayoutGrid, Plus, Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { AppOption } from '@/shared/appRouting';
import type { ConnectionMode, RoutingMode } from '@/shared/types';
import type { useNetworkSettings } from '@/renderer/hooks/useNetworkSettings';
import { useAppListEditor } from '@/renderer/hooks/useAppListEditor';
import {
  useSplitTunnelEditor,
  type SplitTunnelLists,
} from '@/renderer/hooks/useSplitTunnelEditor';
import type { AppListKind } from '../useMobileNav';
import {
  CheckMark,
  ErrorText,
  Foot,
  PageBody,
  Panel,
  RadioRows,
  Row,
  RowGroup,
  SwitchRow,
  Tile,
  WideButton,
  type Tone,
} from './kit';

type NetworkSettings = ReturnType<typeof useNetworkSettings>;

const LETTER_TONES: Tone[] = ['info', 'teal', 'ok', 'warn', 'bad', 'violet'];

/** The app's own icon, or its first letter on a stable color. */
const AppTile: React.FC<{ name: string; app?: AppOption }> = ({
  name,
  app,
}) => {
  const label = app?.description ?? name;
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return (
    <Tile
      image={app?.icon}
      letter={label.charAt(0).toLocaleUpperCase()}
      tone={
        app?.icon
          ? undefined
          : LETTER_TONES[Math.abs(hash) % LETTER_TONES.length]
      }
    />
  );
};

/** Sites and addresses as chips, with one input for hosts, IPs and CIDR. */
const DestinationChips: React.FC<
  SplitTunnelLists & {
    onChange: (next: SplitTunnelLists) => void;
    ariaLabel: string;
    emptyText: string;
  }
> = ({ domains, ips, onChange, ariaLabel, emptyText }) => {
  const { t } = useTranslation();
  const editor = useSplitTunnelEditor({ domains, ips, onChange });
  const entries = [
    ...domains.map((value) => ({ kind: 'domain' as const, value })),
    ...ips.map((value) => ({ kind: 'ip' as const, value })),
  ];
  return (
    <div className="flex flex-col gap-3 p-4 rounded-2xl bg-s1 border border-line">
      <div className="flex gap-2">
        <input
          type="text"
          value={editor.draft}
          placeholder={t('settings.network.splitTunnelPlaceholder')}
          aria-label={ariaLabel}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          onChange={(e) => editor.setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            editor.add();
          }}
          className="flex-1 min-w-0 h-11 px-3.5 rounded-xl border border-line2 bg-s2 text-fg text-[15px] leading-5 outline-none focus:border-acc-fill placeholder:text-fg3"
        />
        <button
          type="button"
          onClick={editor.add}
          disabled={editor.draft.trim().length === 0 || editor.atLimit}
          aria-label={t('settings.network.splitTunnelAdd')}
          className="w-11 h-11 shrink-0 inline-flex items-center justify-center rounded-xl bg-acc-fill text-white disabled:opacity-50"
        >
          <Plus aria-hidden strokeWidth={2} className="w-5 h-5" />
        </button>
      </div>
      {editor.error && <ErrorText>{editor.error}</ErrorText>}
      {entries.length === 0 ? (
        <p className="m-0 text-[13px] leading-[18px] text-fg3">{emptyText}</p>
      ) : (
        <ul className="m-0 p-0 list-none flex flex-wrap gap-2">
          {entries.map(({ kind, value }) => (
            <li
              key={`${kind}:${value}`}
              className="min-h-9 inline-flex items-center gap-0.5 pl-3 pr-0.5 rounded-[10px] bg-s2 border border-line font-mono text-[13px] leading-4 break-all"
            >
              {value}
              <button
                type="button"
                onClick={() => editor.remove(kind, value)}
                aria-label={t('settings.network.splitTunnelRemove', {
                  entry: value,
                })}
                className="w-8 h-8 shrink-0 inline-flex items-center justify-center rounded-lg text-fg3"
              >
                <X aria-hidden strokeWidth={2.25} className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

/** A routing app list: rows with a remove cross and the picker button. */
const AppList: React.FC<{
  apps: string[];
  knownApps: readonly AppOption[];
  emptyText: string;
  onChange: (next: string[]) => void;
  onPick: () => void;
}> = ({ apps, knownApps, emptyText, onChange, onPick }) => {
  const { t } = useTranslation();
  const byName = useMemo(
    () => new Map(knownApps.map((app) => [app.name, app])),
    [knownApps],
  );
  return (
    <>
      {apps.length === 0 ? (
        <Foot>{emptyText}</Foot>
      ) : (
        <RowGroup>
          {apps.map((name) => {
            const app = byName.get(name);
            return (
              <Row
                key={name}
                tile={<AppTile name={name} app={app} />}
                label={app?.description ?? name}
                hint={name}
                hintMono
                trailing={
                  <button
                    type="button"
                    onClick={() =>
                      onChange(apps.filter((entry) => entry !== name))
                    }
                    aria-label={t('settings.network.splitTunnelRemove', {
                      entry: name,
                    })}
                    className="w-10 h-10 shrink-0 -mr-2 inline-flex items-center justify-center rounded-[20px] text-fg3"
                  >
                    <X aria-hidden strokeWidth={2} className="w-5 h-5" />
                  </button>
                }
              />
            );
          })}
        </RowGroup>
      )}
      <WideButton icon={LayoutGrid} onClick={onPick}>
        {t('mobile.settings.pickApps')}
      </WideButton>
    </>
  );
};

interface RoutingPageProps {
  net: NetworkSettings;
  locked: boolean;
  connectionMode: ConnectionMode;
  knownApps: readonly AppOption[];
  onPickApps: (list: AppListKind) => void;
}

/** What goes through the VPN and what goes direct. */
export const RoutingPage: React.FC<RoutingPageProps> = ({
  net,
  locked,
  connectionMode,
  knownApps,
  onPickApps,
}) => {
  const { t } = useTranslation();
  const { perfSettings: settings, updatePerfField: update } = net;
  const mode = settings.routingMode;
  const appCount = (count: number) =>
    count > 0 ? t('mobile.count.appsShort', { count }) : undefined;

  return (
    <PageBody lead={t('settings.network.routingRulesHint')}>
      <Panel title={t('mobile.settings.routingMode')} locked={locked}>
        <RadioRows<RoutingMode>
          label={t('mobile.settings.routingMode')}
          value={mode}
          onChange={(next) => update('routingMode', next)}
          options={[
            {
              value: 'all',
              label: t('settings.network.routingModeAll'),
              desc: t('settings.network.routingModeAllDesc'),
            },
            {
              value: 'sites',
              label: t('settings.network.routingModeSites'),
              desc: t('settings.network.routingModeSitesDesc'),
            },
            {
              value: 'apps',
              label: t('settings.network.routingModeApps'),
              desc: t('settings.network.routingModeAppsDesc'),
            },
          ]}
        />
      </Panel>

      {mode === 'sites' && (
        <Panel
          title={t('settings.network.routingProxySites')}
          desc={t('settings.network.routingProxySitesHint')}
          locked={locked}
        >
          <DestinationChips
            domains={settings.proxyDomains}
            ips={settings.proxyIps}
            ariaLabel={t('settings.network.routingProxySites')}
            emptyText={t('settings.network.routingProxySitesEmpty')}
            onChange={({ domains, ips }) => {
              update('proxyDomains', domains);
              update('proxyIps', ips);
            }}
          />
        </Panel>
      )}

      {mode === 'apps' && (
        <Panel
          title={t('settings.network.routingProxyApps')}
          note={appCount(settings.proxyApps.length)}
          desc={t('settings.network.routingProxyAppsHint')}
          locked={locked}
        >
          <AppList
            apps={settings.proxyApps}
            knownApps={knownApps}
            emptyText={t('settings.network.routingProxyAppsEmpty')}
            onChange={(apps) => update('proxyApps', apps)}
            onPick={() => onPickApps('proxy')}
          />
        </Panel>
      )}

      <Panel
        title={t('mobile.settings.splitTunnel')}
        note="split tunneling"
        desc={t('settings.network.splitTunnelHint')}
        locked={locked}
        foot={<Foot>{t('settings.network.splitTunnelDnsNote')}</Foot>}
      >
        <DestinationChips
          domains={settings.bypassDomains}
          ips={settings.bypassIps}
          ariaLabel={t('settings.network.splitTunnel')}
          emptyText={
            mode === 'all'
              ? t('settings.network.splitTunnelEmpty')
              : t('settings.network.routingExclusionsEmpty')
          }
          onChange={({ domains, ips }) => {
            update('bypassDomains', domains);
            update('bypassIps', ips);
          }}
        />
      </Panel>

      <Panel
        title={t('settings.network.routingDirectApps')}
        note={appCount(settings.directApps.length)}
        desc={t('settings.network.routingDirectAppsHint')}
        locked={locked}
        foot={
          <>
            <Foot>{t('settings.network.routingAppsCaseNote')}</Foot>
            <Foot tone={connectionMode === 'proxy' ? 'warn' : undefined}>
              {t('settings.network.routingAppsProxyNote')}
            </Foot>
          </>
        }
      >
        <AppList
          apps={settings.directApps}
          knownApps={knownApps}
          emptyText={t('settings.network.routingDirectAppsEmpty')}
          onChange={(apps) => update('directApps', apps)}
          onPick={() => onPickApps('direct')}
        />
      </Panel>

      <Panel title={t('mobile.settings.blocking')} locked={locked}>
        <RowGroup>
          <SwitchRow
            label={t('settings.network.blockAds')}
            hint={t('settings.network.blockAdsHint')}
            checked={settings.blockAds}
            onChange={(value) => update('blockAds', value)}
          />
          <SwitchRow
            label={t('settings.network.blockBittorrent')}
            hint={t('settings.network.blockBittorrentHint')}
            checked={settings.blockBittorrent}
            onChange={(value) => update('blockBittorrent', value)}
          />
        </RowGroup>
      </Panel>

      <PriorityPanel />
    </PageBody>
  );
};

/** Index of the blocking step in `mobile.settings.prioritySteps`. */
const BLOCKING_STEP = 2;

/**
 * First match wins. On Android the app steps come first: the VpnService
 * keeps those apps out of the tunnel (or lets only them in) before Xray
 * sees any traffic, see `planAndroidRouting`.
 */
const PriorityPanel: React.FC = () => {
  const { t } = useTranslation();
  const steps = t('mobile.settings.prioritySteps', {
    returnObjects: true,
  }) as string[];
  return (
    <Panel
      title={t('mobile.settings.priority')}
      note={t('mobile.settings.priorityNote')}
      foot={<Foot>{t('mobile.settings.priorityFoot')}</Foot>}
    >
      <ol className="m-0 py-1 list-none rounded-2xl bg-s1 border border-line">
        {steps.map((label, index) => {
          const tone =
            index === BLOCKING_STEP
              ? 'warn'
              : index === steps.length - 1
                ? 'info'
                : null;
          return (
            <li key={label} className="min-h-11 flex items-center gap-3 px-4">
              <span
                className={clsx(
                  'w-6 h-6 shrink-0 rounded-full flex items-center justify-center text-xs leading-4 font-semibold tabular-nums',
                  tone === 'warn'
                    ? 'bg-warn-soft text-warn'
                    : tone === 'info'
                      ? 'bg-acc-soft text-acc'
                      : 'bg-s3 text-fg2',
                )}
              >
                {index + 1}
              </span>
              <span
                className={clsx(
                  'text-sm leading-5 font-medium',
                  tone === 'warn'
                    ? 'text-warn'
                    : tone === 'info'
                      ? 'text-acc'
                      : 'text-fg',
                )}
              >
                {label}
              </span>
            </li>
          );
        })}
      </ol>
    </Panel>
  );
};

interface AppsPageProps {
  net: NetworkSettings;
  list: AppListKind;
  locked: boolean;
  knownApps: readonly AppOption[];
  loading: boolean;
}

/** Installed apps with checkboxes; Enter in the search adds a package as typed. */
export const AppsPage: React.FC<AppsPageProps> = ({
  net,
  list,
  locked,
  knownApps,
  loading,
}) => {
  const { t } = useTranslation();
  const field = list === 'direct' ? 'directApps' : 'proxyApps';
  const apps = net.perfSettings[field];
  const editor = useAppListEditor({
    apps,
    knownApps,
    onChange: (next) => net.updatePerfField(field, next),
  });

  const query = editor.draft.trim().toLowerCase();
  const matches = (app: AppOption) =>
    query.length === 0 ||
    app.name.toLowerCase().includes(query) ||
    (app.description?.toLowerCase().includes(query) ?? false);
  const known = new Set(knownApps.map((app) => app.name));
  // Packages typed in by hand stay on the list so they can be unticked.
  const typed: AppOption[] = apps
    .filter((name) => !known.has(name))
    .map((name) => ({ name, description: null, icon: null, system: false }));
  const user = [...typed, ...knownApps.filter((app) => !app.system)].filter(
    matches,
  );
  const system = knownApps.filter((app) => app.system).filter(matches);

  const toggle = (name: string) => {
    editor.setError(null);
    if (apps.includes(name)) editor.remove(name);
    else editor.addNames([name]);
  };

  const row = (app: AppOption) => {
    const on = apps.includes(app.name);
    const label = app.description ?? app.name;
    return (
      <Row
        key={app.name}
        role="checkbox"
        ariaChecked={on}
        ariaLabel={label}
        tile={<AppTile name={app.name} app={app} />}
        label={label}
        hint={app.name}
        hintMono
        trailing={<CheckMark on={on} />}
        onClick={() => toggle(app.name)}
      />
    );
  };

  const empty = loading
    ? t('settings.network.routingAppsLoading')
    : query.length > 0
      ? t('settings.network.routingAppsNoMatches')
      : t('settings.network.routingAppsNoRunning');

  return (
    <PageBody>
      <Panel locked={locked}>
        <label className="h-12 flex items-center gap-2.5 px-3.5 rounded-[14px] bg-s2 border border-line2 text-fg3">
          <Search aria-hidden strokeWidth={2} className="w-5 h-5 shrink-0" />
          <input
            type="search"
            value={editor.draft}
            placeholder={t('settings.network.routingAppsPlaceholder')}
            aria-label={t('settings.network.routingAppsPlaceholder')}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            onChange={(e) => editor.setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              editor.add();
            }}
            className="flex-1 min-w-0 h-[46px] bg-transparent text-fg text-[15px] leading-5 outline-none placeholder:text-fg3"
          />
        </label>
        {editor.error && <ErrorText>{editor.error}</ErrorText>}
      </Panel>

      {user.length === 0 && system.length === 0 ? (
        <Foot>{empty}</Foot>
      ) : (
        <>
          {user.length > 0 && (
            <Panel
              title={t('mobile.settings.installedApps')}
              note={t('mobile.count.appsShort', { count: user.length })}
              locked={locked}
            >
              <RowGroup>{user.map(row)}</RowGroup>
            </Panel>
          )}
          {system.length > 0 && (
            <Panel
              title={t('settings.network.routingAppsSystemGroup')}
              locked={locked}
            >
              <RowGroup>{system.map(row)}</RowGroup>
            </Panel>
          )}
          <div className="-mt-4 px-1">
            <Foot>{t('mobile.settings.appsTypeHint')}</Foot>
          </div>
        </>
      )}
    </PageBody>
  );
};
