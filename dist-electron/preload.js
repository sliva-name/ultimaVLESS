"use strict";
const electron = require("electron");
function createListener(channel) {
  return (callback) => {
    const listener = (_, data) => callback(data);
    electron.ipcRenderer.on(channel, listener);
    return () => {
      electron.ipcRenderer.removeListener(channel, listener);
    };
  };
}
electron.contextBridge.exposeInMainWorld("electronAPI", {
  connect: (server) => electron.ipcRenderer.send("connect", server),
  disconnect: () => electron.ipcRenderer.send("disconnect"),
  saveSubscription: (payload) => electron.ipcRenderer.invoke("save-subscription", payload),
  onUpdateServers: createListener("update-servers"),
  onConnectionStatus: createListener("connection-status"),
  onConnectionError: createListener("connection-error"),
  onConnectionMonitorEvent: createListener("connection-monitor-event"),
  getConnectionMonitorStatus: () => electron.ipcRenderer.invoke("get-connection-monitor-status"),
  setAutoSwitching: (enabled) => electron.ipcRenderer.invoke("set-auto-switching", enabled),
  clearBlockedServers: () => electron.ipcRenderer.invoke("clear-blocked-servers"),
  getServers: () => electron.ipcRenderer.invoke("get-servers"),
  getSubscriptionUrl: () => electron.ipcRenderer.invoke("get-subscription-url"),
  getManualLinks: () => electron.ipcRenderer.invoke("get-manual-links"),
  getSelectedServerId: () => electron.ipcRenderer.invoke("get-selected-server-id"),
  getConnectionMode: () => electron.ipcRenderer.invoke("get-connection-mode"),
  setConnectionMode: (mode) => electron.ipcRenderer.invoke("set-connection-mode", mode),
  getConnectionStatus: () => electron.ipcRenderer.invoke("get-connection-status"),
  getLogs: () => electron.ipcRenderer.invoke("get-logs"),
  openLogFolder: () => electron.ipcRenderer.send("open-log-folder"),
  getAppVersion: () => electron.ipcRenderer.invoke("get-app-version"),
  pingServer: (server) => electron.ipcRenderer.invoke("ping-server", server),
  pingAllServers: (force) => electron.ipcRenderer.invoke("ping-all-servers", force)
});
