import React from 'react';
import clsx from 'clsx';
import {
  Activity,
  Cpu,
  Info,
  Layers,
  Route,
  Shield,
  type LucideIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type {
  ConnectionMode,
  PerformanceSettings,
  Subscription,
  VlessConfig,
} from '@/shared/types';
import type { AppSnapshot, UpdateStatus } from '@/shared/ipc';
import type { SettingsPage } from '../useMobileNav';
import { FINGERPRINT_LABELS } from './options';
import {
  Foot,
  NavChevron,
  PageBody,
  Panel,
  Row,
  RowGroup,
  Tile,
  type Tone,
} from './kit';

const DNS_NAMES: Record<string, string> = {
  cloudflare: 'Cloudflare',
  google: 'Google',
  quad9: 'Quad9',
};

/** "Реальная задержка" → "реальная задержка"; "TCP-пинг" stays. */
const lowerFirst = (text: string) =>
  /^\p{Lu}\p{Ll}/u.test(text)
    ? text.charAt(0).toLocaleLowerCase() + text.slice(1)
    : text;

/** The main process keeps the choice for the notification. */
export const LanguageSwitch: React.FC = () => {
  const { t, i18n } = useTranslation();
  
  // Supported languages
  const languages = ['en', 'ru', 'zh', 'fa', 'es', 'tr'] as const;

  return (
    <div
      role="radiogroup"
      aria-label={t('mobile.settings.languageAria')}
      className="h-10 shrink-0 flex p-[3px] rounded-xl bg-s2 border border-line overflow-x-auto" 
    >
      {languages.map((code) => {
        const on = i18n.language.startsWith(code);
        
        return (
          <button
            key={code}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => void i18n.changeLanguage(code)}
            className={clsx(
              'h-8 px-3 rounded-[9px] text-[13px] leading-4 font-medium shrink-0',
              on ? 'bg-thumb text-fg shadow-thumb' : 'text-fg2',
            )}
          >
            {code.toUpperCase()}
          </button>
        );
      })}
    </div>
  );
};

interface SettingsRootProps {
  servers: VlessConfig[];
  subscriptions: Subscription[];
  settings: PerformanceSettings;
  connectionMode: ConnectionMode;
  snapshot: AppSnapshot;
  appVersion: string;
  update: UpdateStatus | null;
  onOpen: (page: SettingsPage) => void;
}

/** The list of settings sections, each with a summary of what is set. */
export const SettingsRoot: React.FC<SettingsRootProps> = ({
  servers,
  subscriptions,
  settings,
  connectionMode,
  snapshot,
  appVersion,
  update,
  onOpen,
}) => {
  const { t } = useTranslation();
  const join = (parts: (string | null | false)[]) =>
    parts.filter(Boolean).join(' · ');

  const exclusions = settings.bypassDomains.length + settings.bypassIps.length;
  const updateNote =
    update?.version &&
    (update.stage === 'available' ||
      update.stage === 'downloading' ||
      update.stage === 'downloaded')
      ? t(`mobile.settings.aboutUpdate.${update.stage}`, {
          version: update.version,
        })
      : null;

  const nav = (
    page: SettingsPage,
    label: string,
    hint: string,
    icon: LucideIcon,
    tone?: Tone,
  ) => (
    <Row
      key={page}
      tile={<Tile icon={icon} tone={tone} />}
      label={label}
      hint={hint}
      trailing={<NavChevron />}
      onClick={() => onOpen(page)}
    />
  );

  return (
    <PageBody>
      <Panel title={t('mobile.settings.groupServers')}>
        <RowGroup>
          {nav(
            'sources',
            t('settings.sources.subscriptions'),
            join([
              t('mobile.count.subscriptions', { count: subscriptions.length }),
              t('mobile.count.servers', { count: servers.length }),
            ]),
            Layers,
            'info',
          )}
        </RowGroup>
      </Panel>

      <Panel title={t('mobile.settings.groupConnection')}>
        <RowGroup>
          {nav(
            'network',
            t('mobile.settings.network'),
            join([
              t(
                connectionMode === 'tun'
                  ? 'settings.network.tunMode'
                  : 'settings.network.proxyMode',
              ),
              DNS_NAMES[settings.remoteDnsPreset] ??
                t('settings.network.remoteDnsCustom'),
              lowerFirst(
                t(
                  settings.pingMethod === 'tcp'
                    ? 'settings.network.pingMethodTcp'
                    : 'settings.network.pingMethodReal',
                ),
              ),
            ]),
            Shield,
            'ok',
          )}
          {nav(
            'routing',
            t('mobile.settings.routing'),
            join([
              t(
                settings.routingMode === 'sites'
                  ? 'mobile.settings.routingSites'
                  : settings.routingMode === 'apps'
                    ? 'mobile.settings.routingApps'
                    : 'mobile.settings.routingAll',
              ),
              exclusions > 0 &&
                t('mobile.count.exclusions', { count: exclusions }),
              settings.directApps.length > 0 &&
                t('mobile.count.apps', { count: settings.directApps.length }),
            ]),
            Route,
            'violet',
          )}
          {nav(
            'core',
            t('mobile.settings.core'),
            join([
              t(
                settings.muxEnabled
                  ? 'mobile.settings.muxOn'
                  : 'mobile.settings.muxOff',
              ),
              `MTU ${settings.tunMtu}`,
              FINGERPRINT_LABELS[settings.fingerprint] ?? settings.fingerprint,
            ]),
            Cpu,
            'teal',
          )}
        </RowGroup>
      </Panel>

      <Panel
        title={t('mobile.settings.groupApp')}
        foot={<Foot>{t('mobile.settings.tileNote')}</Foot>}
      >
        <RowGroup>
          {nav(
            'diag',
            t('settings.tabs.diagnostics'),
            join([
              t(`mobile.settings.coreState.${snapshot.process.state}`),
              t(
                snapshot.autoSwitchingEnabled
                  ? 'mobile.settings.autoSwitchOn'
                  : 'mobile.settings.autoSwitchOff',
              ),
            ]),
            Activity,
            'warn',
          )}
          {nav(
            'about',
            t('mobile.settings.about'),
            join([appVersion, updateNote]),
            Info,
          )}
        </RowGroup>
      </Panel>
    </PageBody>
  );
};
