import { useCallback, useEffect, useRef, useState } from 'react';
import type { TFunction } from 'i18next';
import type { Subscription, VlessConfig } from '@/shared/types';
import type { ServerDetails } from '@/shared/views/serverDetails';

/** "Added manually" or "Subscription «Work»", under the server's name. */
export function describeServerSource(
  server: Pick<VlessConfig, 'source' | 'subscriptionId'>,
  subscriptions: Subscription[],
  t: TFunction,
): string {
  if (server.source === 'manual') return t('serverDetails.sourceManual');
  const subscription = subscriptions.find(
    (entry) => entry.id === server.subscriptionId,
  );
  return t('serverDetails.sourceSubscription', {
    name: subscription?.name ?? t('sidebar.subscriptionShort'),
  });
}

/** Puts text on the clipboard; Android marks it as sensitive. */
export type ClipboardWriter = (text: string) => Promise<void>;

const writeToClipboard: ClipboardWriter = (text) =>
  navigator.clipboard.writeText(text);

/** Shown instead of a credential until the viewer asks to see it. */
export const MASK = '••••••••';

/** `vless://••••••••`: the kind of link, nothing that grants access. */
export function maskShareLink(link: string): string {
  const scheme = /^([a-z0-9+.-]+):\/\//i.exec(link)?.[1];
  return scheme ? `${scheme}://${MASK}` : MASK;
}

type Loaded =
  | { state: 'loading' }
  | { state: 'failed' }
  | { state: 'ready'; details: ServerDetails | null };

/**
 * One server's parameters for its details card, asked from main while the
 * card is open (`serverId` set) and dropped when it closes. Credentials stay
 * masked until `reveal`; copying needs no reveal. Shared by the desktop
 * dialog and the Android sheet.
 */
export function useServerDetails(
  serverId: string | null,
  writeText: ClipboardWriter = writeToClipboard,
) {
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState<'link' | 'config' | null>(null);
  const [copyFailed, setCopyFailed] = useState(false);
  const copiedTimer = useRef<number | undefined>(undefined);

  // Another server, or the card closed: forget the keys and hide them again.
  const [shownId, setShownId] = useState(serverId);
  if (serverId !== shownId) {
    setShownId(serverId);
    setLoaded({ state: 'loading' });
    setRevealed(false);
    setCopied(null);
    setCopyFailed(false);
  }

  useEffect(() => {
    if (!serverId) return;
    let disposed = false;
    window.electronAPI.getServerDetails(serverId).then(
      (details) => {
        if (!disposed) setLoaded({ state: 'ready', details });
      },
      (error: unknown) => {
        console.error('Failed to load server details', error);
        if (!disposed) setLoaded({ state: 'failed' });
      },
    );
    return () => {
      disposed = true;
    };
  }, [serverId]);

  useEffect(() => () => window.clearTimeout(copiedTimer.current), []);

  const copy = useCallback(
    async (what: 'link' | 'config') => {
      if (loaded.state !== 'ready' || !loaded.details) return;
      const text =
        what === 'link' ? loaded.details.shareLink : loaded.details.rawConfig;
      if (!text) return;
      setCopyFailed(false);
      try {
        await writeText(text);
        setCopied(what);
        window.clearTimeout(copiedTimer.current);
        copiedTimer.current = window.setTimeout(() => setCopied(null), 2000);
      } catch (error) {
        console.error('Failed to copy server details', error);
        setCopied(null);
        setCopyFailed(true);
      }
    },
    [loaded, writeText],
  );

  const details = loaded.state === 'ready' ? loaded.details : null;
  return {
    loading: loaded.state === 'loading',
    /** The request failed, or the server is gone from the catalog. */
    failed:
      loaded.state === 'failed' ||
      (loaded.state === 'ready' && loaded.details === null),
    details,
    hasSecrets:
      !!details?.shareLink || !!details?.fields.some((field) => field.secret),
    revealed,
    toggleReveal: () => setRevealed((value) => !value),
    copied,
    copyFailed,
    copyLink: () => copy('link'),
    copyConfig: () => copy('config'),
  };
}
