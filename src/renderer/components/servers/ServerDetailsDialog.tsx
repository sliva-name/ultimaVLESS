import React from 'react';
import { Check, Copy, Eye, EyeOff, Pencil, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Subscription, VlessConfig } from '@/shared/types';
import {
  Button,
  Dialog,
  ErrorText,
  Foot,
  IconButton,
} from '@/renderer/components/ui';
import {
  describeServerSource,
  MASK,
  maskShareLink,
  useServerDetails,
} from '@/renderer/hooks/useServerDetails';
import { ServerFlag } from './serverParts';

interface ServerDetailsDialogProps {
  /** The server shown; null keeps the dialog closed. */
  server: VlessConfig | null;
  subscriptions: Subscription[];
  onClose: () => void;
  /** Opens the manual links editor, where a manual server is changed. */
  onEditManual: () => void;
}

/**
 * A server's parameters and share link. Keys stay masked until "Show keys";
 * copying works without showing them. Only manual servers can be edited:
 * a subscription brings its servers anew on every refresh.
 */
export const ServerDetailsDialog: React.FC<ServerDetailsDialogProps> = ({
  server,
  subscriptions,
  onClose,
  onEditManual,
}) => {
  const { t } = useTranslation();
  const view = useServerDetails(server?.uuid ?? null);
  const details = view.details;
  const manual = server?.source === 'manual';

  return (
    <Dialog
      open={!!server}
      label={t('serverDetails.title', { name: server?.name ?? '' })}
      onClose={onClose}
    >
      {server && (
        <>
          <header className="shrink-0 flex items-start gap-3 pl-5 pr-3.5 pt-4 pb-3">
            <span className="mt-0.5">
              <ServerFlag server={server} size={22} />
            </span>
            <div className="flex-1 min-w-0 flex flex-col gap-0.5">
              <h2
                dir="auto"
                className="m-0 text-[15px] leading-[22px] font-semibold truncate"
              >
                {server.name}
              </h2>
              <span className="text-xs leading-4 text-fg3 truncate">
                {describeServerSource(server, subscriptions, t)}
              </span>
            </div>
            <IconButton
              icon={X}
              label={t('serverDetails.close')}
              onClick={onClose}
            />
          </header>

          {view.loading ? (
            <div className="px-5 pb-5">
              <Foot>{t('serverDetails.loading')}</Foot>
            </div>
          ) : view.failed || !details ? (
            <div className="px-5 pb-5">
              <ErrorText>{t('serverDetails.failed')}</ErrorText>
            </div>
          ) : (
            <>
              {/* The list scrolls; the link and its buttons stay in view. */}
              <div className="shrink-0 h-7 flex items-center justify-between gap-3 pl-5 pr-2.5">
                <h3 className="m-0 text-xs leading-4 font-semibold text-fg2">
                  {t('serverDetails.params')}
                </h3>
                {view.hasSecrets && (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={view.revealed ? EyeOff : Eye}
                    aria-pressed={view.revealed}
                    onClick={view.toggleReveal}
                  >
                    {t(
                      view.revealed
                        ? 'serverDetails.hide'
                        : 'serverDetails.show',
                    )}
                  </Button>
                )}
              </div>
              <div className="min-h-0 overflow-y-auto px-5 pb-3">
                <dl className="m-0 flex flex-col">
                  {details.fields.map((field, index) => {
                    const shown = !field.secret || view.revealed;
                    return (
                      <div
                        key={`${field.key}-${index}`}
                        className="min-h-7 py-1 box-border flex items-start justify-between gap-4 border-b border-line last:border-b-0"
                      >
                        <dt className="shrink-0 text-xs leading-5 text-fg3">
                          {t(`serverDetails.field.${field.key}`)}
                        </dt>
                        <dd
                          data-selectable={shown ? '' : undefined}
                          data-secret={field.secret ? '' : undefined}
                          className="m-0 min-w-0 font-mono text-xs leading-5 text-fg text-right break-all"
                        >
                          {shown ? field.value : MASK}
                        </dd>
                      </div>
                    );
                  })}
                </dl>
              </div>

              <section className="shrink-0 px-5 pt-3.5 pb-5 border-t border-line flex flex-col gap-2">
                <h3 className="m-0 text-xs leading-4 font-semibold text-fg2">
                  {t('serverDetails.link')}
                </h3>
                {details.shareLink ? (
                  <div
                    data-selectable={view.revealed ? '' : undefined}
                    data-testid="server-share-link"
                    className="max-h-24 overflow-y-auto px-3 py-2 rounded-lg bg-s2 border border-line font-mono text-xs leading-5 text-fg break-all"
                  >
                    {view.revealed
                      ? details.shareLink
                      : maskShareLink(details.shareLink)}
                  </div>
                ) : (
                  <Foot>
                    {t(
                      details.rawConfig
                        ? 'serverDetails.jsonOnly'
                        : 'serverDetails.noLinkYet',
                    )}
                  </Foot>
                )}
                {(details.shareLink || details.rawConfig || manual) && (
                  <div className="flex flex-wrap gap-2">
                    {details.shareLink && (
                      <Button
                        variant="primary"
                        icon={view.copied === 'link' ? Check : Copy}
                        onClick={() => void view.copyLink()}
                      >
                        {t(
                          view.copied === 'link'
                            ? 'serverDetails.copied'
                            : 'serverDetails.copyLink',
                        )}
                      </Button>
                    )}
                    {details.rawConfig && (
                      <Button
                        icon={view.copied === 'config' ? Check : Copy}
                        onClick={() => void view.copyConfig()}
                      >
                        {t(
                          view.copied === 'config'
                            ? 'serverDetails.copied'
                            : 'serverDetails.copyConfig',
                        )}
                      </Button>
                    )}
                    {manual && (
                      <Button
                        icon={Pencil}
                        onClick={() => {
                          onClose();
                          onEditManual();
                        }}
                      >
                        {t('serverDetails.edit')}
                      </Button>
                    )}
                  </div>
                )}
                {view.copyFailed && (
                  <ErrorText>{t('serverDetails.copyFailed')}</ErrorText>
                )}
                <Foot>
                  {t(
                    manual
                      ? 'serverDetails.manualHint'
                      : 'serverDetails.subscriptionHint',
                  )}
                </Foot>
              </section>
            </>
          )}
        </>
      )}
    </Dialog>
  );
};
