export interface ConnectResult {
  ok: boolean;
  error?: string;
  relaunched?: boolean;
}

export interface DisconnectResult {
  ok: boolean;
}

export interface AddSubscriptionPayload {
  name: string;
  url: string;
}

export interface UpdateSubscriptionPayload {
  id: string;
  patch: {
    name?: string;
    url?: string;
    enabled?: boolean;
  };
}

export interface AddSubscriptionResult {
  ok: boolean;
  configCount: number;
  error?: string;
}

export interface SaveManualLinksResult {
  ok: boolean;
  configCount: number;
  error?: string;
}

export interface RefreshSubscriptionsResult {
  ok: boolean;
  configCount: number;
  error?: string;
}

export interface PingResult {
  uuid: string;
  latency: number | null;
}

export interface ImportMobileWhiteListResult {
  ok: boolean;
  configCount: number;
  error?: string;
}
