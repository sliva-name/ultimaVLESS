import React from 'react';
import { Star, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, IconButton } from '@/renderer/components/ui';
import {
  dismissStarPrompt,
  openRepoForStar,
  useStarPrompt,
} from '@/renderer/hooks/useStarPrompt';

interface StarCardProps {
  connected: boolean;
  connectedAt: number;
}

/** The one-time request for a GitHub star, above the connected ring. */
export const StarCard: React.FC<StarCardProps> = ({
  connected,
  connectedAt,
}) => {
  const { t } = useTranslation();
  const visible = useStarPrompt(connected, connectedAt);
  if (!visible) return null;
  return (
    <div
      role="status"
      className="shrink-0 w-full max-w-[560px] mx-auto flex items-center gap-3 py-2.5 pr-2 pl-3.5 rounded-xl bg-s1 border border-line shadow-panel page-in"
    >
      <Star
        aria-hidden
        strokeWidth={1.75}
        className="w-4 h-4 shrink-0 text-warn"
      />
      <div className="flex-1 min-w-0">
        <p className="m-0 text-[13px] leading-[18px] text-fg">
          {t('home.star.title')}
        </p>
        <p className="m-0 text-xs leading-4 text-fg2">{t('home.star.text')}</p>
      </div>
      <Button size="sm" variant="primary" icon={Star} onClick={openRepoForStar}>
        {t('home.star.action')}
      </Button>
      <IconButton
        icon={X}
        label={t('home.star.dismiss')}
        onClick={dismissStarPrompt}
      />
    </div>
  );
};
