import React, { useMemo } from 'react';
import { Layers, Plus, Smartphone } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Subscription, VlessConfig } from '@/shared/types';
import { localizeError } from '@/shared/localizeError';
import { partitionServers } from '@/renderer/components/sidebarModel';
import type { useSourcesSettings } from '@/renderer/hooks/useSourcesSettings';
import { BottomSheet } from '../BottomSheet';
import { PopupMenu } from '../PopupMenu';
import { subscriptionColorIndex } from '../serverParts';
import {
  ErrorText,
  Foot,
  NavChevron,
  PageBody,
  Panel,
  Row,
  RowGroup,
  Switch,
  Tile,
  WideButton,
  type Tone,
} from './kit';

type Sources = ReturnType<typeof useSourcesSettings>;

/** Same slots as the group dots on the servers screen. */
const SUBSCRIPTION_TONES: Tone[] = ['info', 'ok', 'warn', 'bad', 'teal'];

/** Enable / disable and delete, behind the row's ⋮ button. */
const SubscriptionMenu: React.FC<{
  subscription: Subscription;
  onToggle: () => void;
  onDelete: () => void;
}> = ({ subscription, onToggle, onDelete }) => {
  const { t } = useTranslation();
  return (
    <PopupMenu
      label={t('mobile.settings.sources.actions', { name: subscription.name })}
      className="-mr-2.5"
      items={[
        {
          label: t(
            subscription.enabled
              ? 'settings.sources.disableSubscription'
              : 'settings.sources.enableSubscription',
          ),
          onSelect: onToggle,
        },
        {
          label: t('settings.sources.removeSubscription'),
          onSelect: onDelete,
          danger: true,
        },
      ]}
    />
  );
};

interface SourcesPageProps {
  subscriptions: Subscription[];
  servers: VlessConfig[];
  sources: Sources;
  refreshError: string | null;
  onAddSubscription: () => void;
}

/** Subscriptions, the manual links and the mobile white list. */
export const SourcesPage: React.FC<SourcesPageProps> = ({
  subscriptions,
  servers,
  sources,
  refreshError,
  onAddSubscription,
}) => {
  const { t, i18n } = useTranslation();
  const counts = useMemo(
    () => partitionServers(servers).bySubscriptionId,
    [servers],
  );

  return (
    <PageBody lead={t('mobile.settings.sources.lead')}>
      <Panel title={t('mobile.settings.sources.subscriptionsTitle')}>
        {refreshError && (
          <ErrorText>{localizeError(refreshError, i18n.language)}</ErrorText>
        )}
        {subscriptions.length > 0 ? (
          <RowGroup>
            {subscriptions.map((subscription) => (
              <Row
                key={subscription.id}
                tile={
                  <Tile
                    icon={Layers}
                    tone={
                      subscription.enabled
                        ? SUBSCRIPTION_TONES[
                            subscriptionColorIndex(subscription.id)
                          ]
                        : undefined
                    }
                  />
                }
                label={subscription.name}
                status={
                  subscription.enabled
                    ? undefined
                    : {
                        text: t('mobile.settings.sources.disabled'),
                        tone: 'plain',
                      }
                }
                hint={
                  subscription.enabled
                    ? t('mobile.count.servers', {
                        count: counts.get(subscription.id)?.length ?? 0,
                      })
                    : undefined
                }
                trailing={
                  <SubscriptionMenu
                    subscription={subscription}
                    onToggle={() =>
                      void sources.toggleSubscription(subscription)
                    }
                    onDelete={() =>
                      void sources.deleteSubscription(subscription.id)
                    }
                  />
                }
              />
            ))}
          </RowGroup>
        ) : (
          <Foot>{t('settings.sources.noSubscriptions')}</Foot>
        )}
        <WideButton icon={Plus} tone="acc" onClick={onAddSubscription}>
          {t('settings.sources.addSubscription')}
        </WideButton>
      </Panel>

      <Panel
        title={t('settings.sources.manualConfigs')}
        desc={t('settings.sources.manualPlaceholder')}
      >
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void sources.saveManualLinks();
          }}
        >
          <textarea
            rows={4}
            value={sources.manualLinks}
            onChange={(event) => sources.setManualLinks(event.target.value)}
            aria-label={t('settings.sources.manualConfigs')}
            spellCheck={false}
            className="resize-none py-3 px-3.5 rounded-2xl border border-line2 bg-s1 text-fg font-mono text-[13px] leading-5 outline-none focus:border-acc-fill"
          />
          <div className="flex justify-between items-center gap-3 pl-1">
            <span className="text-[13px] leading-[18px] text-fg3">
              {t('settings.sources.manualHint')}
            </span>
            <button
              type="submit"
              disabled={sources.isSavingManual}
              className="shrink-0 h-10 px-4 rounded-xl border border-line2 bg-s2 text-fg text-sm leading-4 font-medium disabled:opacity-60"
            >
              {sources.isSavingManual
                ? t('settings.sources.saving')
                : t('settings.sources.saveManual')}
            </button>
          </div>
          {sources.manualSaveError && (
            <ErrorText>
              {localizeError(sources.manualSaveError, i18n.language)}
            </ErrorText>
          )}
        </form>
      </Panel>

      <Panel title={t('mobile.settings.sources.importTitle')}>
        <RowGroup>
          <Row
            tile={<Tile icon={Smartphone} />}
            label={t('mobile.settings.sources.importLabel')}
            hint={t('settings.sources.openPreview')}
            trailing={<NavChevron />}
            disabled={sources.importingMobileList}
            onClick={() => void sources.importMobileList()}
          />
        </RowGroup>
        {sources.importMobileError && (
          <ErrorText>
            {localizeError(sources.importMobileError, i18n.language)}
          </ErrorText>
        )}
      </Panel>
    </PageBody>
  );
};

/** Bottom sheet that adds a subscription and fetches it right away. */
export const SubscriptionSheet: React.FC<{
  open: boolean;
  sources: Sources;
  onClose: () => void;
}> = ({ open, sources, onClose }) => {
  const { t, i18n } = useTranslation();
  const field =
    'h-12 px-3.5 rounded-xl border border-line2 bg-s2 text-fg text-[15px] leading-5 outline-none focus:border-2 focus:border-acc-fill';
  return (
    <BottomSheet
      open={open}
      label={t('mobile.settings.sources.sheetTitle')}
      title={t('mobile.settings.sources.sheetTitle')}
      description={t('mobile.settings.sources.sheetHint')}
      onClose={onClose}
    >
      {(close) => (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void sources.addSubscription().then((added) => {
              if (added) close();
            });
          }}
          className="flex flex-col gap-4"
        >
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] leading-[18px] font-medium text-fg2">
              {t('mobile.settings.sources.nameLabel')}
            </span>
            <input
              type="text"
              value={sources.newSubName}
              onChange={(event) => sources.setNewSubName(event.target.value)}
              placeholder={t('settings.sources.namePlaceholder')}
              maxLength={100}
              className={field}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] leading-[18px] font-medium text-fg2">
              {t('mobile.settings.sources.urlLabel')}
            </span>
            <input
              type="url"
              inputMode="url"
              value={sources.newSubUrl}
              onChange={(event) => sources.setNewSubUrl(event.target.value)}
              placeholder={t('settings.sources.urlPlaceholder')}
              className={`${field} font-mono text-sm`}
            />
          </label>
          <div className="flex items-center gap-3.5">
            <span className="flex-1 min-w-0 flex flex-col">
              <span className="text-[15px] leading-5 font-medium">
                {t('settings.sources.viaYandex')}
              </span>
              <span className="mt-0.5 text-[13px] leading-[18px] text-fg3">
                {t('settings.sources.viaYandexHint')}
              </span>
            </span>
            <Switch
              checked={sources.newSubViaYandex}
              onChange={sources.setNewSubViaYandex}
              label={t('settings.sources.viaYandex')}
            />
          </div>
          {sources.addError && (
            <ErrorText>
              {localizeError(sources.addError, i18n.language)}
            </ErrorText>
          )}
          <div className="flex flex-col gap-1 pt-1 pb-3">
            <button
              type="submit"
              disabled={sources.isAdding}
              className="h-12 rounded-[14px] bg-acc-fill text-white text-[15px] leading-5 font-medium disabled:opacity-60"
            >
              {sources.isAdding
                ? t('settings.sources.adding')
                : t('settings.sources.addAndFetch')}
            </button>
            <button
              type="button"
              onClick={close}
              className="h-12 rounded-[14px] text-fg2 text-[15px] leading-5 font-medium"
            >
              {t('mobile.settings.sources.cancel')}
            </button>
          </div>
        </form>
      )}
    </BottomSheet>
  );
};
