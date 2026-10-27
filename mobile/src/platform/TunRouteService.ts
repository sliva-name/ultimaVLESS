import type { NetworkAdapterList } from '@/shared/views/tunEnvironment';

/**
 * On Android the VpnService owns the TUN's addresses and routes, so there are
 * no routes to plan or recover and no adapter for the user to pick.
 */
export class TunRouteService {
  public isSupported(): boolean {
    return true;
  }

  public getUnsupportedReason(): string | null {
    return null;
  }

  public getRouteMode(): string | null {
    return null;
  }

  public getDegradedReason(): string | null {
    return null;
  }

  public async listNetworkAdapters(): Promise<NetworkAdapterList> {
    return { supported: false, adapters: [] };
  }

  public async prepareRoutingPlan(): Promise<undefined> {
    return undefined;
  }

  public async recoverOrphanedRoutes(): Promise<void> {}
}

export const tunRouteService = new TunRouteService();
