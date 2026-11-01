import React, { useId, useMemo, useState } from 'react';
import {
  Layers,
  PauseCircle,
  PlayCircle,
  Smartphone,
  Trash2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { localizeError } from '@/shared/localizeError';
import { unwrapYandexTranslate } from '@/shared/subscriptionUrls';
import { useServers } from '@/renderer/hooks/useAppSnapshot';
import { useSourcesSettings } from '@/renderer/hooks/useSourcesSettings';
import { useRefreshSubscriptions } from '@/renderer/hooks/useRefreshSubscriptions';
import {
  partitionServers,
  SUBSCRIPTION_COLORS,
  getSubscriptionColor,
} from '@/renderer/components/sidebarModel';
import { ViaYandexToggle } from '@/renderer/components/ViaYandexToggle';
import {
  Button,
  ErrorText,
  Foot,
  Menu,
  MenuSeparator,
  Page,
  Panel,
  Row,
  RowGroup,
  StatusPill,
  TextField,
  Tile,
  type Tone,
} from '@/renderer/components/ui';

/** Tile tones in the order of the subscription color slots. */
const SUBSCRIPTION_TONES: Tone[] = ['info', 'ok', 'warn', 'bad', 'teal'];

const subscriptionTone = (id: string): Tone =>
  SUBSCRIPTION_TONES[
    Math.max(0, SUBSCRIPTION_COLORS.indexOf(getSubscriptionColor(id)))
  ];

/** «Подписки и импорт»: subscriptions, manual links, the mobile list. */
export const SubscriptionsPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const formId = useId();
  const { servers, subscriptions } = useServers();
  const sources = useSourcesSettings(true);
  const { refreshing, refreshError, refreshAll } = useRefreshSubscriptions();
  const [adding, setAdding] = useState(false);
  const localize = (message: string) => localizeError(message, i18n.language);

  const counts = useMemo(
    () => partitionServers(servers).bySubscriptionId,
    [servers],
  );
  const manualCount = useMemo(
    () => servers.filter((server) => server.source === 'manual').length,
    [servers],
  );

  // What the data can say about a subscription: off, on, or on but empty.
  const status = (enabled: boolean, count: number) =>
    !enabled
      ? {
          text: t('pages.subs.statusOff'),
          tone: 'plain' as Tone,
          hint: t('pages.subs.hiddenHint'),
        }
      : count === 0
        ? {
            text: t('pages.subs.statusEmpty'),
            tone: 'warn' as Tone,
            hint: t('pages.subs.emptyHint'),
          }
        : {
            text: t('pages.subs.statusOn'),
            tone: 'ok' as Tone,
            hint: t('count.servers', { count }),
          };

  return (
    <Page
      title={t('pages.subs.title')}
      lead={t('pages.subs.lead')}
      actions={
        <>
          <Button
            onClick={() => void refreshAll()}
            disabled={refreshing || subscriptions.length === 0}
          >
            {refreshing
              ? t('pages.subs.refreshing')
              : t('pages.subs.refreshAll')}
          </Button>
          <Button
            variant="primary"
            aria-expanded={adding}
            aria-controls={formId}
            onClick={() => {
              sources.setAddError(null);
              setAdding((open) => !open);
            }}
          >
            {t('settings.sources.addSubscription')}
          </Button>
        </>
      }
    >
      {adding && (
        <form
          id={formId}
          aria-label={t('pages.subs.addTitle')}
          onSubmit={(event) => {
            event.preventDefault();
            void sources.addSubscription().then((ok) => {
              if (ok) setAdding(false);
            });
          }}
          className="page-in p-4 rounded-xl bg-s1 border border-line shadow-panel flex flex-col gap-3"
        >
          <h2 className="m-0 text-sm leading-5 font-semibold">
            {t('pages.subs.addTitle')}
          </h2>
          <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-2">
            <TextField
              autoFocus
              value={sources.newSubUrl}
              aria-label={t('empty.urlLabel')}
              placeholder={t('settings.sources.urlPlaceholder')}
              onChange={(e) => sources.setNewSubUrl(e.target.value)}
            />
            <TextField
              value={sources.newSubName}
              maxLength={100}
              aria-label={t('empty.nameLabel')}
              placeholder={t('settings.sources.namePlaceholder')}
              onChange={(e) => sources.setNewSubName(e.target.value)}
            />
          </div>
          <ViaYandexToggle
            checked={sources.newSubViaYandex}
            onChange={sources.setNewSubViaYandex}
          />
          {sources.addError && (
            <ErrorText>{localize(sources.addError)}</ErrorText>
          )}
          <div className="flex justify-end gap-2">
            <Button onClick={() => setAdding(false)}>
              {t('servers.cancel')}
            </Button>
            <Button type="submit" variant="primary" disabled={sources.isAdding}>
              {sources.isAdding
                ? t('settings.sources.adding')
                : t('settings.sources.addAndFetch')}
            </Button>
          </div>
        </form>
      )}

      <Panel
        title={t('pages.subs.subscriptions')}
        note={
          subscriptions.length > 0
            ? `${t('count.subscriptions', { count: subscriptions.length })} · ${t(
                'count.servers',
                { count: servers.length - manualCount },
              )}`
            : undefined
        }
      >
        {refreshError && <ErrorText>{localize(refreshError)}</ErrorText>}
        {subscriptions.length > 0 ? (
          <RowGroup>
            {subscriptions.map((subscription) => {
              const count = counts.get(subscription.id)?.length ?? 0;
              const state = status(subscription.enabled, count);
              const viaYandex = unwrapYandexTranslate(subscription.url);
              return (
                <Row
                  key={subscription.id}
                  tile={
                    <Tile
                      icon={Layers}
                      tone={
                        subscription.enabled
                          ? subscriptionTone(subscription.id)
                          : undefined
                      }
                    />
                  }
                  label={subscription.name}
                  hint={
                    <>
                      {state.hint}
                      {viaYandex && ` · ${t('settings.sources.viaYandexNote')}`}
                      <span className="block font-mono text-[11px] leading-4 text-fg3 truncate">
                        {viaYandex ?? subscription.url}
                      </span>
                    </>
                  }
                  trailing={
                    <span className="flex shrink-0 items-center gap-1">
                      <StatusPill tone={state.tone}>{state.text}</StatusPill>
                      <Menu
                        size={28}
                        label={t('pages.subs.actions', {
                          name: subscription.name,
                        })}
                        items={[
                          {
                            label: subscription.enabled
                              ? t('settings.sources.disableSubscription')
                              : t('settings.sources.enableSubscription'),
                            icon: subscription.enabled
                              ? PauseCircle
                              : PlayCircle,
                            onSelect: () =>
                              void sources.toggleSubscription(subscription),
                          },
                          MenuSeparator,
                          {
                            label: t('servers.deleteSubscription'),
                            icon: Trash2,
                            danger: true,
                            onSelect: () =>
                              void sources.deleteSubscription(subscription.id),
                            confirm: {
                              title: t('servers.deleteTitle', {
                                name: subscription.name,
                              }),
                              body: t('servers.deleteBody', {
                                servers: t('count.servers', { count }),
                              }),
                              action: t('servers.delete'),
                            },
                          },
                        ]}
                      />
                    </span>
                  }
                />
              );
            })}
          </RowGroup>
        ) : (
          <Foot>{t('settings.sources.noSubscriptions')}</Foot>
        )}
      </Panel>

      <Panel
        title={t('settings.sources.manualConfigs')}
        note={
          manualCount > 0
            ? t('count.servers', { count: manualCount })
            : undefined
        }
        desc={t('settings.sources.manualPlaceholder')}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void sources.saveManualLinks();
          }}
          className="flex flex-col gap-2"
        >
          <textarea
            rows={4}
            aria-label={t('settings.sources.manualConfigs')}
            value={sources.manualLinks}
            onChange={(e) => sources.setManualLinks(e.target.value)}
            placeholder={t('settings.sources.manualPlaceholder')}
            spellCheck={false}
            className="resize-y box-border px-3 py-2.5 rounded-xl border border-line2 bg-s1 text-fg font-mono text-xs leading-5 outline-none placeholder:text-fg3 focus:border-acc-fill"
          />
          {sources.manualSaveError && (
            <ErrorText>{localize(sources.manualSaveError)}</ErrorText>
          )}
          <div className="flex items-center justify-between gap-3">
            <Foot>{t('settings.sources.manualHint')}</Foot>
            <Button type="submit" size="sm" disabled={sources.isSavingManual}>
              {sources.isSavingManual
                ? t('settings.sources.saving')
                : t('settings.sources.saveManual')}
            </Button>
          </div>
        </form>
      </Panel>

      <Panel title={t('pages.subs.importTitle')}>
        <RowGroup>
          <Row
            tile={<Tile icon={Smartphone} />}
            label={t('pages.subs.importLabel')}
            hint={t('pages.subs.importHint')}
            trailing={
              <Button
                size="sm"
                onClick={() => void sources.importMobileList()}
                disabled={sources.importingMobileList}
              >
                {t('pages.subs.openPreview')}
              </Button>
            }
          />
        </RowGroup>
        {sources.importMobileError && (
          <ErrorText>{localize(sources.importMobileError)}</ErrorText>
        )}
      </Panel>
    </Page>
  );
};
