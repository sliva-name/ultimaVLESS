export const IPC_INVOKE_CHANNELS = {
  connect: 'connect',
  disconnect: 'disconnect',
  getLogs: 'get-logs',
  openLogFolder: 'open-log-folder',
  openExternalUrl: 'open-external-url',
  importMobileWhiteListSubscription: 'import-mobile-white-list-subscription',
  addSubscription: 'add-subscription',
  updateSubscription: 'update-subscription',
  deleteSubscription: 'delete-subscription',
  refreshSubscriptions: 'refresh-subscriptions',
  getManualLinks: 'get-manual-links',
  saveManualLinks: 'save-manual-links',
  getAppSnapshot: 'get-app-snapshot',
  setSelectedServerId: 'set-selected-server-id',
  getConnectionMode: 'get-connection-mode',
  setConnectionMode: 'set-connection-mode',
  getAppVersion: 'get-app-version',
  pingServer: 'ping-server',
  pingAllServers: 'ping-all-servers',
  getConnectionMonitorStatus: 'get-connection-monitor-status',
  getTunCapabilityStatus: 'get-tun-capability-status',
  setAutoSwitching: 'set-auto-switching',
  clearBlockedServers: 'clear-blocked-servers',
  getPerformanceSettings: 'get-performance-settings',
  setPerformanceSettings: 'set-performance-settings',
  getUiLanguage: 'get-ui-language',
  setUiLanguage: 'set-ui-language',
  getUpdateStatus: 'get-update-status',
  checkForUpdates: 'check-for-updates',
  installUpdate: 'install-update',
} as const;

export const IPC_EVENT_CHANNELS = {
  appSnapshotChanged: 'app-snapshot-changed',
  connectionMonitorEvent: 'connection-monitor-event',
  updateStatus: 'update-status',
} as const;

export type IpcInvokeChannel =
  (typeof IPC_INVOKE_CHANNELS)[keyof typeof IPC_INVOKE_CHANNELS];
export type IpcEventChannel =
  (typeof IPC_EVENT_CHANNELS)[keyof typeof IPC_EVENT_CHANNELS];
