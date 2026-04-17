import React, { useCallback, KeyboardEvent } from 'react';
import clsx from 'clsx';
import { VlessConfig } from '@/shared/types';
import { CountryFlag } from '@/renderer/components/CountryFlag';

interface ServerItemProps {
  server: VlessConfig;
  isSelected: boolean;
  isConnected: boolean;
  onSelect: (server: VlessConfig) => void;
}

const pingBadgeClass = (ping: number) =>
  ping < 100 ? 'text-green-400 bg-green-500/10' :
  ping < 200 ? 'text-yellow-400 bg-yellow-500/10' :
  ping < 300 ? 'text-orange-400 bg-orange-500/10' :
  'text-red-400 bg-red-500/10';

export const ServerItem = React.memo<ServerItemProps>(({ server, isSelected, isConnected, onSelect }) => {
  const disabled = isConnected && !isSelected;

  const handleSelect = useCallback(() => {
    if (!disabled) onSelect(server);
  }, [disabled, onSelect, server]);

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect(server);
    }
  }, [disabled, onSelect, server]);

  return (
    <div
      onClick={handleSelect}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-selected={isSelected}
      aria-disabled={disabled}
      data-testid={`server-item-${server.uuid}`}
      data-server-uuid={server.uuid}
      className={clsx(
        'group p-3.5 rounded-xl cursor-pointer transition-all duration-200 border relative overflow-hidden',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60',
        isSelected
          ? 'bg-linear-to-br from-primary/20 via-primary/15 to-primary/10 border-primary/40 text-white shadow-lg shadow-primary/20'
          : 'bg-linear-to-br from-gray-800/30 to-gray-800/20 hover:from-gray-700/40 hover:to-gray-700/30 text-gray-300 border-gray-700/30 hover:border-gray-600/50',
        disabled && 'opacity-50 cursor-not-allowed'
      )}
    >
      {!isSelected && (
        <div className="absolute inset-0 bg-linear-to-r from-primary/0 via-primary/5 to-primary/0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />
      )}

      <div className="flex items-center gap-3 relative z-10">
        <div className={clsx(
          'w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-200 shadow-lg overflow-hidden',
          isSelected
            ? 'bg-linear-to-br from-primary/30 to-primary/20 border border-primary/40 ring-2 ring-primary/30'
            : 'bg-linear-to-br from-gray-700/50 to-gray-800/50 border border-gray-600/30 group-hover:from-gray-600/50 group-hover:to-gray-700/50 group-hover:ring-1 group-hover:ring-gray-500/30'
        )}>
          <CountryFlag server={server} size={28} className="rounded-sm" />
        </div>
        <div className="flex-1 overflow-hidden min-w-0">
          <div className="flex items-center justify-between gap-2">
            <div className={clsx(
              'font-semibold truncate text-sm mb-0.5 transition-colors',
              isSelected ? 'text-white' : 'text-gray-200 group-hover:text-white'
            )}>
              {server.name}
            </div>
            {server.ping != null ? (
              <div className={clsx(
                'text-xs font-semibold px-1.5 py-0.5 rounded shrink-0',
                pingBadgeClass(server.ping)
              )}>
                {server.ping} ms
              </div>
            ) : (
              <div className="text-xs text-gray-500 shrink-0">—</div>
            )}
          </div>
          <div className="text-xs text-gray-500 truncate font-mono">
            {server.address}
          </div>
        </div>
      </div>
    </div>
  );
});

ServerItem.displayName = 'ServerItem';
