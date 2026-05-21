import React, { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Clock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TrafficSnapshot } from '@/shared/ipc';

interface ConnectionSessionStatsProps {
  trafficSnapshot: TrafficSnapshot;
}

const padZero = (value: number) => value.toString().padStart(2, '0');

function formatDuration(totalMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(totalMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${padZero(hours)}:${padZero(minutes)}:${padZero(seconds)}`;
  }
  return `${padZero(minutes)}:${padZero(seconds)}`;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const fractionDigits =
    unitIndex === 0 ? 0 : value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(fractionDigits)} ${units[unitIndex]}`;
}

function formatRate(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond)}/s`;
}

interface StatTileProps {
  icon: React.ReactNode;
  label: string;
  primary: string;
  secondary?: string;
}

const StatTile: React.FC<StatTileProps> = ({
  icon,
  label,
  primary,
  secondary,
}) => (
  <div className="min-w-0 p-2.5 sm:p-3 rounded-xl bg-linear-to-br from-gray-800/50 to-gray-800/30 border border-gray-700/50">
    <div className="flex items-center gap-1.5 sm:gap-2 mb-1 sm:mb-1.5 min-w-0">
      <span className="shrink-0">{icon}</span>
      <div className="text-[10px] sm:text-[11px] text-gray-400 uppercase tracking-wider font-semibold truncate">
        {label}
      </div>
    </div>
    <div className="font-mono text-sm sm:text-base text-white font-semibold tabular-nums truncate">
      {primary}
    </div>
    {secondary && (
      <div className="mt-0.5 text-[11px] sm:text-xs text-gray-400 font-mono tabular-nums truncate">
        {secondary}
      </div>
    )}
  </div>
);

/**
 * Isolated session counters so a 1s duration tick does not re-render the full
 * connection panel (large button, cards, animations).
 */
export const ConnectionSessionStats = React.memo<ConnectionSessionStatsProps>(
  ({ trafficSnapshot }) => {
    const { t } = useTranslation();
    const connectedAt = trafficSnapshot.connectedAt;
    const [tick, setTick] = useState(() => Date.now());

    useEffect(() => {
      if (connectedAt === 0) return;
      const interval = window.setInterval(() => setTick(Date.now()), 1000);
      return () => window.clearInterval(interval);
    }, [connectedAt]);

    const sessionDurationMs = Math.max(
      trafficSnapshot.sessionDurationMs,
      tick - connectedAt,
    );

    return (
      <div
        className="mt-4 sm:mt-5 grid grid-cols-3 gap-2 sm:gap-3 w-full max-w-2xl animate-[fadeIn_0.4s_ease-out]"
        aria-label={t('status.session.label')}
      >
        <StatTile
          icon={<Clock className="w-4 h-4 text-green-400" />}
          label={t('status.session.duration')}
          primary={formatDuration(sessionDurationMs)}
        />
        <StatTile
          icon={<ArrowDown className="w-4 h-4 text-sky-400" />}
          label={t('status.session.download')}
          primary={formatBytes(trafficSnapshot.downloadBytes)}
          secondary={formatRate(trafficSnapshot.downloadBps)}
        />
        <StatTile
          icon={<ArrowUp className="w-4 h-4 text-purple-400" />}
          label={t('status.session.upload')}
          primary={formatBytes(trafficSnapshot.uploadBytes)}
          secondary={formatRate(trafficSnapshot.uploadBps)}
        />
      </div>
    );
  },
);

ConnectionSessionStats.displayName = 'ConnectionSessionStats';
