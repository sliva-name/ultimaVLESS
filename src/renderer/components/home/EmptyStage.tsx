import React, { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { localizeError } from '@/shared/localizeError';
import { useSourcesSettings } from '@/renderer/hooks/useSourcesSettings';
import { Button, ErrorText, TextField } from '@/renderer/components/ui';
import { ViaYandexToggle } from '@/renderer/components/ViaYandexToggle';

interface EmptyStageProps {
  onOpenSources: () => void;
}

/** First run: no servers yet, so the stage asks for a source. */
export const EmptyStage: React.FC<EmptyStageProps> = ({ onOpenSources }) => {
  const { t, i18n } = useTranslation();
  const id = useId();
  const sources = useSourcesSettings(true);
  const localize = (message: string) => localizeError(message, i18n.language);

  return (
    <div className="flex-[1_0_auto] flex items-center justify-center p-8">
      <div className="page-in w-full max-w-[420px] flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <h1 className="m-0 text-[22px] leading-7 font-semibold tracking-[-0.02em]">
            {t('empty.title')}
          </h1>
          <p className="m-0 text-[13px] leading-5 text-fg2">
            {t('empty.body')}
          </p>
        </div>

        <form
          aria-labelledby={`${id}-sub`}
          onSubmit={(event) => {
            event.preventDefault();
            void sources.addSubscription();
          }}
          className="p-4 rounded-xl bg-s1 border border-line shadow-panel flex flex-col gap-4"
        >
          <h2 id={`${id}-sub`} className="m-0 text-sm leading-5 font-semibold">
            {t('empty.subscription')}
          </h2>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs leading-4 font-medium text-fg2">
              {t('empty.urlLabel')}
            </span>
            <TextField
              type="url"
              value={sources.newSubUrl}
              onChange={(e) => sources.setNewSubUrl(e.target.value)}
              placeholder={t('settings.sources.urlPlaceholder')}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs leading-4 font-medium text-fg2">
              {t('empty.nameLabel')}
            </span>
            <TextField
              value={sources.newSubName}
              maxLength={100}
              onChange={(e) => sources.setNewSubName(e.target.value)}
              placeholder={t('settings.sources.namePlaceholder')}
            />
          </label>
          <ViaYandexToggle
            checked={sources.newSubViaYandex}
            onChange={sources.setNewSubViaYandex}
          />
          {sources.addError && (
            <ErrorText>{localize(sources.addError)}</ErrorText>
          )}
          <Button
            type="submit"
            variant="primary"
            disabled={sources.isAdding}
            className="self-start"
          >
            {sources.isAdding
              ? t('settings.sources.adding')
              : t('settings.sources.addAndFetch')}
          </Button>
        </form>

        <form
          aria-labelledby={`${id}-links`}
          onSubmit={(event) => {
            event.preventDefault();
            void sources.saveManualLinks();
          }}
          className="p-4 rounded-xl bg-s1 border border-line shadow-panel flex flex-col gap-3"
        >
          <h2
            id={`${id}-links`}
            className="m-0 text-sm leading-5 font-semibold"
          >
            {t('empty.manualTitle')}
          </h2>
          <textarea
            rows={3}
            aria-label={t('empty.manualLabel')}
            value={sources.manualLinks}
            onChange={(e) => sources.setManualLinks(e.target.value)}
            placeholder={t('settings.sources.manualPlaceholder')}
            className="resize-y box-border px-3 py-2 rounded-lg border border-line2 bg-s2 text-fg text-[13px] leading-5 outline-none placeholder:text-fg3 focus:border-acc-fill"
          />
          {sources.manualSaveError && (
            <ErrorText>{localize(sources.manualSaveError)}</ErrorText>
          )}
          <div className="flex items-center justify-between gap-3">
            <Button type="submit" disabled={sources.isSavingManual}>
              {sources.isSavingManual
                ? t('settings.sources.saving')
                : t('empty.saveLinks')}
            </Button>
            <button
              type="button"
              onClick={onOpenSources}
              className="text-xs leading-4 text-acc hover:underline"
            >
              {t('empty.importMobile')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
