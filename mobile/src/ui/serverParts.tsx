import React from 'react';
import clsx from 'clsx';
import { Clock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { VlessConfig } from '@/shared/types';
import {
  SUBSCRIPTION_COLORS,
  getSubscriptionColor,
} from '@/renderer/components/sidebarModel';
import { latencyClass } from '@/renderer/components/servers/serverParts';

export {
  describeServer,
  ServerFlag,
} from '@/renderer/components/servers/serverParts';

/** A subscription's color slot, the same one the desktop sidebar uses. */
export function subscriptionColorIndex(subscriptionId: string): number {
  return Math.max(
    0,
    SUBSCRIPTION_COLORS.indexOf(getSubscriptionColor(subscriptionId)),
  );
}

interface PingBadgeProps {
  server: Pick<VlessConfig, 'ping' | 'pingStale'>;
  /** Waiting for this server's answer in the running check. */
  pending?: boolean;
}

/** Gray when there is no answer or the measurement is stale. */
export const PingBadge: React.FC<PingBadgeProps> = ({ server, pending }) => {
  const { t } = useTranslation();
  const { ping, pingStale } = server;
  const fresh = !pending && ping != null && !pingStale;
  return (
    <span
      className={clsx(
        'shrink-0 min-w-16 h-7 px-2.5 inline-flex items-center justify-center gap-1 rounded-lg text-[13px] leading-4 font-semibold tabular-nums whitespace-nowrap',
        fresh ? latencyClass(ping) : 'bg-s3 text-fg3',
      )}
    >
      {pending ? (
        '···'
      ) : ping == null ? (
        '—'
      ) : (
        <>
          {pingStale && (
            <Clock className="w-[13px] h-[13px]" strokeWidth={2} aria-hidden />
          )}
          {ping} {t('sidebar.ms')}
        </>
      )}
    </span>
  );
};
