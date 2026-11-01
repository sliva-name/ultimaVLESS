import React from 'react';
import { useTranslation } from 'react-i18next';
import { Toggle } from './ui';

interface ViaYandexToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
}

/** «Fetch through Yandex Translate» switch of the add-subscription forms. */
export const ViaYandexToggle: React.FC<ViaYandexToggleProps> = ({
  checked,
  onChange,
}) => {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-3">
      <span className="flex-1 min-w-0 flex flex-col">
        <span className="text-[13px] leading-5 font-medium">
          {t('settings.sources.viaYandex')}
        </span>
        <span className="mt-0.5 text-xs leading-[18px] text-fg3">
          {t('settings.sources.viaYandexHint')}
        </span>
      </span>
      <Toggle
        checked={checked}
        onChange={onChange}
        ariaLabel={t('settings.sources.viaYandex')}
      />
    </div>
  );
};
