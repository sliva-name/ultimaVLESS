import React from 'react';
import { Check, Copy, Eye, EyeOff, Pencil } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Subscription, VlessConfig } from '@/shared/types';
import {
  describeServerSource,
  MASK,
  maskShareLink,
  useServerDetails,
  type ClipboardWriter,
} from '@/renderer/hooks/useServerDetails';
import { UltimaCore } from '../native/UltimaCore';
import { BottomSheet } from './BottomSheet';
import { ErrorText, Foot } from './settings/kit';

/** A share link grants access: keep it out of the copy preview. */
const copySensitive: ClipboardWriter = (text) =>
  UltimaCore.copyText({ text, label: 'Ultima VLESS', sensitive: true });

interface ServerDetailsSheetProps {
  open: boolean;
  server: VlessConfig | null;
  subscriptions: Subscription[];
  onClose: () => void;
  /** Opens Sources, where manual links are edited. */
  onEditManual: () => void;
}

/** The server's parameters and link, as on desktop, in a bottom sheet. */
export const ServerDetailsSheet: React.FC<ServerDetailsSheetProps> = ({
  open,
  server,
  subscriptions,
  onClose,
  onEditManual,
}) => {
  const { t } = useTranslation();
  if (!server) return null;
  return (
    <BottomSheet
      open={open}
      label={t('serverDetails.title', { name: server.name })}
      title={<span dir="auto">{server.name}</span>}
      description={describeServerSource(server, subscriptions, t)}
      onClose={onClose}
    >
      {(close) => (
        <DetailsBody
          server={server}
          onEditManual={() => {
            close();
            onEditManual();
          }}
        />
      )}
    </BottomSheet>
  );
};

/** Mounted only while the sheet shows, so the keys go when it closes. */
const DetailsBody: React.FC<{
  server: VlessConfig;
  onEditManual: () => void;
}> = ({ server, onEditManual }) => {
  const { t } = useTranslation();
  const view = useServerDetails(server.uuid, copySensitive);
  const details = view.details;
  const manual = server.source === 'manual';

  if (view.loading) {
    return (
      <div className="pb-6">
        <Foot>{t('serverDetails.loading')}</Foot>
      </div>
    );
  }
  if (view.failed || !details) {
    return (
      <div className="pb-6">
        <ErrorText>{t('serverDetails.failed')}</ErrorText>
      </div>
    );
  }

  const button =
    'h-12 inline-flex items-center justify-center gap-2 rounded-[14px] text-[15px] leading-5 font-medium';
  return (
    <div className="flex flex-col gap-5 pb-3">
      <section className="flex flex-col">
        <div className="h-10 flex items-center justify-between gap-3">
          <h3 className="m-0 text-[13px] leading-[18px] font-semibold text-fg2">
            {t('serverDetails.params')}
          </h3>
          {view.hasSecrets && (
            <button
              type="button"
              aria-pressed={view.revealed}
              onClick={view.toggleReveal}
              className="h-10 inline-flex items-center gap-1.5 pl-2 rounded-[10px] text-acc text-sm leading-4 font-medium"
            >
              {view.revealed ? (
                <EyeOff
                  aria-hidden
                  strokeWidth={2}
                  className="w-[18px] h-[18px]"
                />
              ) : (
                <Eye
                  aria-hidden
                  strokeWidth={2}
                  className="w-[18px] h-[18px]"
                />
              )}
              {t(view.revealed ? 'serverDetails.hide' : 'serverDetails.show')}
            </button>
          )}
        </div>
        <dl className="m-0 flex flex-col">
          {details.fields.map((field, index) => {
            const shown = !field.secret || view.revealed;
            return (
              <div
                key={`${field.key}-${index}`}
                className="min-h-11 py-2.5 box-border flex items-start justify-between gap-4 border-b border-line"
              >
                <dt className="shrink-0 text-[13px] leading-5 text-fg3">
                  {t(`serverDetails.field.${field.key}`)}
                </dt>
                <dd
                  data-selectable={shown ? '' : undefined}
                  className="m-0 min-w-0 font-mono text-[13px] leading-5 text-fg text-right break-all"
                >
                  {shown ? field.value : MASK}
                  {field.fromDevice && (
                    <span className="block font-sans text-fg3 select-none">
                      {t('serverDetails.fromDevice')}
                    </span>
                  )}
                </dd>
              </div>
            );
          })}
        </dl>
      </section>

      <section className="flex flex-col gap-2.5">
        <h3 className="m-0 text-[13px] leading-[18px] font-semibold text-fg2">
          {t('serverDetails.link')}
        </h3>
        {details.shareLink ? (
          <div
            data-selectable={view.revealed ? '' : undefined}
            className="max-h-32 overflow-y-auto px-3.5 py-2.5 rounded-xl bg-s2 border border-line font-mono text-[13px] leading-5 text-fg break-all"
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
        {details.shareLink && (
          <button
            type="button"
            onClick={() => void view.copyLink()}
            className={`${button} bg-acc-fill text-white`}
          >
            {view.copied === 'link' ? (
              <Check aria-hidden strokeWidth={2} className="w-5 h-5" />
            ) : (
              <Copy aria-hidden strokeWidth={2} className="w-5 h-5" />
            )}
            {t(
              view.copied === 'link'
                ? 'serverDetails.copied'
                : 'serverDetails.copyLink',
            )}
          </button>
        )}
        {details.rawConfig && (
          <button
            type="button"
            onClick={() => void view.copyConfig()}
            className={`${button} bg-s2 border border-line2 text-fg`}
          >
            {view.copied === 'config' ? (
              <Check aria-hidden strokeWidth={2} className="w-5 h-5" />
            ) : (
              <Copy aria-hidden strokeWidth={2} className="w-5 h-5" />
            )}
            {t(
              view.copied === 'config'
                ? 'serverDetails.copied'
                : 'serverDetails.copyConfig',
            )}
          </button>
        )}
        {manual && (
          <button
            type="button"
            onClick={onEditManual}
            className={`${button} bg-s2 border border-line2 text-fg`}
          >
            <Pencil aria-hidden strokeWidth={2} className="w-5 h-5" />
            {t('serverDetails.edit')}
          </button>
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
    </div>
  );
};
