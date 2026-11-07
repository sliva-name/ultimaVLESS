import React from 'react';
import clsx from 'clsx';
import { Star, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  dismissStarPrompt,
  openRepoForStar,
  useStarPrompt,
} from '@/renderer/hooks/useStarPrompt';

interface StarCardProps {
  connected: boolean;
  connectedAt: number;
  className?: string;
}

/** The one-time request for a GitHub star, under the header while connected. */
export const StarCard: React.FC<StarCardProps> = ({
  connected,
  connectedAt,
  className,
}) => {
  const { t } = useTranslation();
  const visible = useStarPrompt(connected, connectedAt);
  if (!visible) return null;
  return (
    <div
      role="status"
      className={clsx(
        'shrink-0 flex items-center gap-3 py-2.5 pr-1.5 pl-3.5 rounded-xl bg-s1 border border-line',
        className,
      )}
    >
      <Star
        aria-hidden
        strokeWidth={2}
        className="w-[18px] h-[18px] shrink-0 text-warn"
      />
      <div className="flex-1 min-w-0 flex flex-col">
        <span className="text-[13px] leading-[18px] font-medium">
          {t('home.star.title')}
        </span>
        <span className="text-xs leading-4 text-fg2">
          {t('home.star.text')}
        </span>
      </div>
      <button
        type="button"
        onClick={openRepoForStar}
        className="shrink-0 h-9 px-3.5 rounded-[10px] bg-acc-fill text-white text-[13px] leading-4 font-medium"
      >
        {t('home.star.action')}
      </button>
      <button
        type="button"
        aria-label={t('home.star.dismiss')}
        onClick={dismissStarPrompt}
        className="shrink-0 w-9 h-9 flex items-center justify-center rounded-[10px] text-fg2"
      >
        <X aria-hidden strokeWidth={2} className="w-[18px] h-[18px]" />
      </button>
    </div>
  );
};
