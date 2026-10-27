import { useCallback, useEffect, useState } from 'react';

export type MobileTab = 'home' | 'servers' | 'settings';

function tabFromState(state: unknown): MobileTab {
  const tab = (state as { tab?: unknown } | null)?.tab;
  return tab === 'servers' || tab === 'settings' ? tab : 'home';
}

/**
 * Tabs as browser history, so Android's back gesture returns to Home before
 * it leaves the app (the WebView goes back while it has history). At most one
 * entry sits above Home.
 */
export function useTabHistory(): [MobileTab, (tab: MobileTab) => void] {
  const [tab, setTabState] = useState<MobileTab>(() =>
    tabFromState(history.state),
  );

  useEffect(() => {
    if (history.state?.tab === undefined) {
      history.replaceState({ tab: 'home' }, '');
    }
    const onPopState = (event: PopStateEvent) => {
      setTabState(tabFromState(event.state));
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const setTab = useCallback((next: MobileTab) => {
    const current = tabFromState(history.state);
    if (next === current) return;
    if (next === 'home') {
      history.back();
      return;
    }
    if (current === 'home') history.pushState({ tab: next }, '');
    else history.replaceState({ tab: next }, '');
    setTabState(next);
  }, []);

  return [tab, setTab];
}
