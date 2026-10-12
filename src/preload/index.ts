import { contextBridge, ipcRenderer } from 'electron'
import type { AppState, DesktopAPI, RunEvent } from '../shared/types'

const api: DesktopAPI = {
  state: () => ipcRenderer.invoke('state'),
  saveSettings: (settings) => ipcRenderer.invoke('settings-save', settings),
  saveProvider: (provider, key) => ipcRenderer.invoke('provider-save', provider, key),
  removeProvider: (id) => ipcRenderer.invoke('provider-remove', id),
  removeKey: (id) => ipcRenderer.invoke('key-remove', id),
  refreshModels: (id) => ipcRenderer.invoke('models-refresh', id),
  testProvider: (id) => ipcRenderer.invoke('provider-test', id),
  run: (input) => ipcRenderer.invoke('run', input),
  cancel: (id) => ipcRenderer.invoke('cancel', id),
  history: (query) => ipcRenderer.invoke('history', query),
  historyItems: (ids) => ipcRenderer.invoke('history-items', ids),
  deleteHistory: (id) => ipcRenderer.invoke('history-delete', id),
  clearHistory: () => ipcRenderer.invoke('history-clear'),
  insights: () => ipcRenderer.invoke('insights'),
  insightStatus: (id, status) => ipcRenderer.invoke('insight-status', id, status),
  rejectChange: (id, from) => ipcRenderer.invoke('change-reject', id, from),
  summarize: () => ipcRenderer.invoke('summarize'),
  retrySummary: (id) => ipcRenderer.invoke('summary-retry', id),
  exportData: (kind) => ipcRenderer.invoke('export', kind),
  importConfig: () => ipcRenderer.invoke('config-import'),
  openSettings: (tab) => ipcRenderer.invoke('settings-open', tab),
  closeWindow: () => ipcRenderer.invoke('window-close'),
  minimizeWindow: () => ipcRenderer.invoke('window-minimize'),
  resizeContent: (height) => ipcRenderer.invoke('window-content-resize', height),
  copy: (text) => ipcRenderer.invoke('copy', text),
  paste: () => ipcRenderer.invoke('paste'),
  onState: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, state: AppState) => listener(state)
    ipcRenderer.on('state-changed', wrapped)
    return () => ipcRenderer.removeListener('state-changed', wrapped)
  },
  onRun: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, event: RunEvent) => listener(event)
    ipcRenderer.on('run-event', wrapped)
    return () => ipcRenderer.removeListener('run-event', wrapped)
  }
}
contextBridge.exposeInMainWorld('desktop', api)
contextBridge.exposeInMainWorld('platform', process.platform)
contextBridge.exposeInMainWorld('onSettingsTab', (listener: (tab: string) => void) => {
  const wrapped = (_event: Electron.IpcRendererEvent, tab: string) => listener(tab)
  ipcRenderer.on('settings-tab', wrapped)
  return () => ipcRenderer.removeListener('settings-tab', wrapped)
})
