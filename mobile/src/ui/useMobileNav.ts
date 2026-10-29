import { useCallback, useEffect, useRef, useState } from 'react';

export type MobileTab = 'home' | 'servers' | 'settings';

export type SettingsPage =
  | 'root'
  | 'sources'
  | 'network'
  | 'routing'
  | 'apps'
  | 'core'
  | 'diag'
  | 'about';

/** Which routing list the app picker edits. */
export type AppListKind = 'direct' | 'proxy';

export interface MobileRoute {
  tab: MobileTab;
  /** Settings screen; `root` on the other tabs. */
  page: SettingsPage;
  list?: AppListKind;
  /** The "New subscription" sheet over the sources page. */
  sheet?: boolean;
}

export const HOME_ROUTE: MobileRoute = { tab: 'home', page: 'root' };

const TABS: readonly MobileTab[] = ['home', 'servers', 'settings'];
const PAGES: readonly SettingsPage[] = [
  'root',
  'sources',
  'network',
  'routing',
  'apps',
  'core',
  'diag',
  'about',
];

function isRoute(value: unknown): value is MobileRoute {
  const route = value as MobileRoute | null;
  return (
    !!route &&
    TABS.includes(route.tab) &&
    PAGES.includes(route.page) &&
    route.tab !== 'home'
  );
}

/** The screens above Home, bottom first, as stored in `history.state`. */
function chainFromState(state: unknown): MobileRoute[] {
  const chain = (state as { nav?: unknown } | null)?.nav;
  return Array.isArray(chain) && chain.every(isRoute) ? chain : [];
}

function sameRoute(a: MobileRoute, b: MobileRoute): boolean {
  return (
    a.tab === b.tab &&
    a.page === b.page &&
    a.list === b.list &&
    !!a.sheet === !!b.sheet
  );
}

/**
 * Screens as browser history, so Android's back gesture walks back through
 * them before it leaves the app (the WebView goes back while it has
 * history). Home is the bottom entry; every entry stores the whole chain of
 * screens above it, so a jump to another tab unwinds to the shared part
 * and pushes the rest.
 */
export function useMobileNav() {
  const [chain, setChain] = useState<MobileRoute[]>(() =>
    chainFromState(history.state),
  );
  /** A jump waiting for `history.go` to land before it replaces the top. */
  const pendingRef = useRef<MobileRoute[] | null>(null);

  useEffect(() => {
    if (!Array.isArray((history.state as { nav?: unknown } | null)?.nav)) {
      history.replaceState({ nav: [] }, '');
    }
    const onPopState = (event: PopStateEvent) => {
      const pending = pendingRef.current;
      if (pending) {
        pendingRef.current = null;
        const kept = chainFromState(event.state).length;
        history.replaceState({ nav: pending.slice(0, kept) }, '');
        for (let i = kept + 1; i <= pending.length; i++) {
          history.pushState({ nav: pending.slice(0, i) }, '');
        }
        setChain(pending);
        return;
      }
      setChain(chainFromState(event.state));
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  /** Shows `target` (the screens above Home) with Home under it. */
  const navigate = useCallback((target: MobileRoute[]) => {
    const current = chainFromState(history.state);
    let shared = 0;
    while (
      shared < current.length &&
      shared < target.length &&
      sameRoute(current[shared], target[shared])
    ) {
      shared += 1;
    }
    const pops = current.length - shared;
    if (pops === 0 && shared === target.length) return;

    if (pops === 0 || (pops === 1 && shared < target.length)) {
      // Stay on this entry (or overwrite the top one) and push the rest.
      let next = shared;
      if (pops === 1) {
        next += 1;
        history.replaceState({ nav: target.slice(0, next) }, '');
      }
      for (let i = next + 1; i <= target.length; i++) {
        history.pushState({ nav: target.slice(0, i) }, '');
      }
      setChain(target);
      return;
    }
    if (shared === target.length) {
      history.go(-pops);
      return;
    }
    // Back to the entry right above the shared part, then overwrite it.
    pendingRef.current = target;
    history.go(-(pops - 1));
  }, []);

  const back = useCallback(() => {
    if (chainFromState(history.state).length > 0) history.back();
  }, []);

  const route = chain.length > 0 ? chain[chain.length - 1] : HOME_ROUTE;
  return { route, chain, navigate, back };
}

export type MobileNavigate = (target: MobileRoute[]) => void;

/** The chain that opens a settings screen from anywhere. */
export function settingsChain(
  page: SettingsPage,
  extra: Partial<MobileRoute> = {},
): MobileRoute[] {
  const root: MobileRoute = { tab: 'settings', page: 'root' };
  if (page === 'root') return [root];
  if (page === 'apps') {
    return [
      root,
      { tab: 'settings', page: 'routing' },
      { tab: 'settings', page: 'apps', ...extra },
    ];
  }
  const target: MobileRoute = { tab: 'settings', page };
  if (extra.sheet) {
    return [root, target, { ...target, sheet: true }];
  }
  return [root, target];
}
