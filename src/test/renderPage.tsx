import React from 'react';
import { render } from '@testing-library/react';
import { AppSnapshotProvider } from '@/renderer/hooks/useAppSnapshot';
import {
  useNetworkSettings,
  type NetworkSettings,
} from '@/renderer/hooks/useNetworkSettings';

/** Holds the shared network-settings draft, as the app shell does. */
const NetworkDraft: React.FC<{
  page: (net: NetworkSettings) => React.ReactNode;
}> = ({ page }) => {
  const net = useNetworkSettings(true);
  return <>{page(net)}</>;
};

/** Renders a settings page over the snapshot provider and the draft. */
export function renderWithNetwork(
  page: (net: NetworkSettings) => React.ReactNode,
) {
  return render(
    <AppSnapshotProvider>
      <NetworkDraft page={page} />
    </AppSnapshotProvider>,
  );
}
