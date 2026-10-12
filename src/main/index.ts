import {
  app,
  BrowserWindow,
  Menu,
  Tray,
  globalShortcut,
  ipcMain,
  safeStorage,
  clipboard,
  dialog,
  nativeImage,
  protocol,
  net,
  screen,
  nativeTheme
} from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { z } from 'zod'
import { AppError, providerSchema, settingsSchema, type Settings, type Task } from '../shared/types'
import { Service } from './service'
import { CredentialVault, Store } from './storage'

protocol.registerSchemesAsPrivileged([
  { scheme: 'prompt-tune', privileges: { secure: true, standard: true, supportFetchAPI: true } }
])
if (process.env.PROMPT_TUNE_USER_DATA) app.setPath('userData', resolve(process.env.PROMPT_TUNE_USER_DATA))
app.setName('PromptTune')
let service: Service
let mainWindow: BrowserWindow | null = null
let settingsWindow: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false
let registeredShortcut = ''
const isMac = process.platform === 'darwin'
const rendererRoot = resolve(__dirname, '../renderer')
const string = z.string().max(10000)

function text(en: string, zh: string): string {
  return service.locale() === 'zh-CN' ? zh : en
}
function updateTheme(settings: Settings): void {
  nativeTheme.themeSource = settings.theme === 'black' ? 'dark' : settings.theme
  for (const window of BrowserWindow.getAllWindows())
    window.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#111113' : '#fafafa')
}
function loadWindow(window: BrowserWindow, settings = false, tab = 'general'): void {
  const suffix = settings ? `?window=settings#${tab}` : ''
  if (process.env.ELECTRON_RENDERER_URL) void window.loadURL(`${process.env.ELECTRON_RENDERER_URL}${suffix}`)
  else void window.loadURL(`prompt-tune://bundle/index.html${suffix}`)
}
function secureWindow(window: BrowserWindow): void {
  if (isMac) window.setWindowButtonVisibility(false)
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) =>
    callback(false)
  )
  window.on('enter-full-screen', () => window.setFullScreen(false))
  window.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.alt || input.shift || !(isMac ? input.meta : input.control)) return
    const key = input.key.toLowerCase()
    if (key === 'w') {
      event.preventDefault()
      window.close()
    }
    if (key === 'q') {
      event.preventDefault()
      app.quit()
    }
    if (key === ',') {
      event.preventDefault()
      showSettings()
    }
  })
}
function visibleBounds(settings: Settings) {
  if (!settings.bounds) return { width: 540, height: 328 }
  const bounds = settings.bounds
  const area = screen.getDisplayMatching(bounds).workArea
  return {
    width: Math.min(Math.max(bounds.width, 440), area.width),
    height: Math.min(Math.max(bounds.height, 304), area.height),
    x: Math.max(area.x, Math.min(bounds.x, area.x + area.width - Math.min(bounds.width, area.width))),
    y: Math.max(area.y, Math.min(bounds.y, area.y + area.height - Math.min(bounds.height, area.height)))
  }
}
function createMain(): BrowserWindow {
  const settings = service.store.settings()
  const window = new BrowserWindow({
    ...visibleBounds(settings),
    minWidth: 440,
    minHeight: 304,
    show: false,
    title: 'PromptTune',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#111113' : '#fafafa',
    resizable: true,
    fullscreenable: false,
    maximizable: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 13 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  mainWindow = window
  window.setAlwaysOnTop(settings.alwaysOnTop, 'floating')
  if (isMac) window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  secureWindow(window)
  let boundsTimer: ReturnType<typeof setTimeout>
  const saveBounds = () => {
    clearTimeout(boundsTimer)
    boundsTimer = setTimeout(() => {
      if (!window.isDestroyed())
        service.store.saveSettings({ ...service.store.settings(), bounds: window.getBounds() })
    }, 300)
  }
  window.on('resize', saveBounds)
  window.on('move', saveBounds)
  window.on('close', (event) => {
    if (!quitting) {
      event.preventDefault()
      window.hide()
    }
  })
  window.on('closed', () => {
    clearTimeout(boundsTimer)
    mainWindow = null
  })
  window.once('ready-to-show', () => {
    window.show()
    window.focus()
  })
  loadWindow(window)
  return window
}
function showMain(): void {
  const window = mainWindow && !mainWindow.isDestroyed() ? mainWindow : createMain()
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}
function showSettings(tab = 'general'): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show()
    settingsWindow.focus()
    settingsWindow.webContents.send('settings-tab', tab)
    return
  }
  const window = new BrowserWindow({
    width: 820,
    height: 700,
    minWidth: 680,
    minHeight: 560,
    title: text('PromptTune Settings', 'PromptTune 设置'),
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#111113' : '#fafafa',
    resizable: true,
    fullscreenable: false,
    maximizable: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 19 },
    alwaysOnTop: service.store.settings().alwaysOnTop,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })
  settingsWindow = window
  secureWindow(window)
  window.on('closed', () => {
    settingsWindow = null
  })
  window.once('ready-to-show', () => {
    window.show()
    window.focus()
  })
  loadWindow(window, true, tab)
}
function registerShortcut(settings: Settings): void {
  if (registeredShortcut === settings.shortcut) return
  try {
    if (
      globalShortcut.register(settings.shortcut, () => {
        if (mainWindow?.isVisible() && mainWindow.isFocused()) mainWindow.hide()
        else showMain()
      })
    ) {
      if (registeredShortcut) globalShortcut.unregister(registeredShortcut)
      registeredShortcut = settings.shortcut
      service.shortcutError = false
    } else service.shortcutError = true
  } catch {
    service.shortcutError = true
  }
}
function updateMenu(): void {
  const menu: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'PromptTune',
      submenu: [
        { label: text('About PromptTune', '关于 PromptTune'), role: 'about' },
        { type: 'separator' },
        { label: text('Settings…', '设置…'), accelerator: 'CommandOrControl+,', click: () => showSettings() },
        { label: text('Show PromptTune', '显示 PromptTune'), click: showMain },
        { type: 'separator' },
        { label: text('Hide PromptTune', '隐藏 PromptTune'), role: 'hide' },
        { label: text('Hide Others', '隐藏其他应用'), role: 'hideOthers' },
        { type: 'separator' },
        {
          label: text('Quit PromptTune', '退出 PromptTune'),
          accelerator: 'CommandOrControl+Q',
          click: () => app.quit()
        }
      ]
    },
    {
      label: text('Edit', '编辑'),
      submenu: [
        { label: text('Undo', '撤销'), role: 'undo' },
        { label: text('Redo', '重做'), role: 'redo' },
        { type: 'separator' },
        { label: text('Cut', '剪切'), role: 'cut' },
        { label: text('Copy', '复制'), role: 'copy' },
        { label: text('Paste', '粘贴'), role: 'paste' },
        { label: text('Select All', '全选'), role: 'selectAll' }
      ]
    },
    {
      label: text('Window', '窗口'),
      submenu: [
        { label: text('Minimize', '最小化'), role: 'minimize' },
        {
          label: text('Close Window', '关闭窗口'),
          accelerator: 'CommandOrControl+W',
          click: () => BrowserWindow.getFocusedWindow()?.close()
        },
        { label: text('Show PromptTune', '显示 PromptTune'), click: showMain }
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(menu))
  tray?.setContextMenu(
    Menu.buildFromTemplate([
      { label: text('Show PromptTune', '显示 PromptTune'), click: showMain },
      { label: text('Settings…', '设置…'), click: () => showSettings() },
      { type: 'separator' },
      { label: text('Quit', '退出'), click: () => app.quit() }
    ])
  )
  if (settingsWindow) settingsWindow.setTitle(text('PromptTune Settings', 'PromptTune 设置'))
}
function broadcast(channel: string, data: unknown): void {
  for (const window of BrowserWindow.getAllWindows())
    if (!window.isDestroyed()) window.webContents.send(channel, data)
}
function handle(channel: string, fn: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => unknown): void {
  ipcMain.handle(channel, async (event, ...args) => {
    const source = event.senderFrame?.url ?? ''
    let validOrigin = false
    try {
      validOrigin = process.env.ELECTRON_RENDERER_URL
        ? new URL(source).origin === new URL(process.env.ELECTRON_RENDERER_URL).origin
        : new URL(source).origin === 'null' && source.startsWith('prompt-tune://bundle/')
    } catch {
      /* Reject malformed or missing frame URLs. */
    }
    if (
      !validOrigin ||
      event.senderFrame !== event.sender.mainFrame ||
      !BrowserWindow.fromWebContents(event.sender)
    )
      return { ok: false, error: 'invalid_sender' }
    try {
      return { ok: true, data: await fn(event, ...args) }
    } catch (error) {
      return {
        ok: false,
        error:
          error instanceof AppError
            ? error.code
            : error instanceof z.ZodError
              ? 'invalid_configuration'
              : 'unexpected_error'
      }
    }
  })
}
function registerIpc(): void {
  handle('state', () => service.state())
  handle('settings-save', (_event, value) => service.saveSettings(value))
  handle('provider-save', (_event, value, key) =>
    service.saveProvider(value, key === undefined ? undefined : z.string().max(4096).parse(key))
  )
  handle('provider-remove', (_event, id) => service.removeProvider(string.parse(id)))
  handle('key-remove', (_event, id) => service.removeKey(string.parse(id)))
  handle('models-refresh', (_event, id) => service.refreshModels(string.parse(id)))
  handle('provider-test', (_event, id) => service.testProvider(string.parse(id)))
  handle('run', (_event, input) => service.run(input))
  handle('cancel', (_event, id) => service.cancel(string.parse(id)))
  handle('history', (_event, query) => service.store.history(z.string().max(500).parse(query)))
  handle('history-items', (_event, ids) =>
    z
      .array(z.string().uuid())
      .max(1000)
      .parse(ids)
      .map((id) => service.store.historyItem(id))
      .filter(Boolean)
  )
  handle('history-delete', (_event, id) => service.deleteHistory(string.parse(id)))
  handle('history-clear', () => service.clearHistory())
  handle('insights', () => service.store.insights())
  handle('insight-status', (_event, id, status) =>
    service.insightStatus(string.parse(id), z.enum(['active', 'mastered', 'ignored']).parse(status))
  )
  handle('change-reject', (_event, id, from) => service.rejectChange(string.parse(id), string.parse(from)))
  handle('summarize', () => service.summarize())
  handle('summary-retry', (_event, id) => service.retrySummary(string.parse(id)))
  handle('settings-open', (_event, tab) => {
    showSettings(tab ? z.enum(['general', 'models', 'history', 'insights']).parse(tab) : 'general')
    return null
  })
  handle('window-close', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close()
    return null
  })
  handle('window-minimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
    return null
  })
  handle('window-content-resize', (event, value) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (window !== mainWindow || !window) throw new AppError('invalid_sender')
    const height = z.number().finite().min(200).max(5000).parse(value)
    const bounds = window.getBounds()
    const area = screen.getDisplayMatching(bounds).workArea
    const nextHeight = Math.min(Math.max(Math.ceil(height), 304), area.height)
    if (Math.abs(nextHeight - bounds.height) > 1)
      window.setBounds(
        {
          ...bounds,
          height: nextHeight,
          y: Math.max(area.y, Math.min(bounds.y, area.y + area.height - nextHeight))
        },
        isMac
      )
    return null
  })
  handle('copy', async (_event, value) => {
    await clipboard.writeText(z.string().max(100000).parse(value))
    return null
  })
  handle('paste', async () => (await clipboard.readText()).slice(0, 20000))
  handle('export', async (event, kind) => {
    const type = z.enum(['history', 'config']).parse(kind)
    const file = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender)!, {
      defaultPath: `prompt-tune-${type}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (file.canceled || !file.filePath) return false
    const allHistory = service.store.db
      .prepare('SELECT data FROM history ORDER BY created_at DESC')
      .all()
      .map((row) => JSON.parse(row.data as string))
    const data =
      type === 'history'
        ? { version: 1, history: allHistory, insights: service.store.insights() }
        : {
            version: 1,
            settings: service.store.settings(),
            providers: service.store.providers().map((provider) => ({ ...provider, status: 'untested' }))
          }
    writeFileSync(file.filePath, JSON.stringify(data, null, 2), { mode: 0o600 })
    return true
  })
  handle('config-import', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)!
    const file = await dialog.showOpenDialog(window, {
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (file.canceled || !file.filePaths[0]) return null
    const schema = z.object({
      version: z.literal(1),
      settings: settingsSchema,
      providers: z.array(providerSchema).max(100)
    })
    const raw = readFileSync(file.filePaths[0], 'utf8')
    if (raw.length > 2000000) throw new AppError('invalid_configuration')
    const data = schema.parse(JSON.parse(raw))
    if (new Set(data.providers.map((provider) => provider.id)).size !== data.providers.length)
      throw new AppError('invalid_configuration')
    for (const binding of Object.values(data.settings.bindings))
      if (
        !data.providers.some(
          (provider) =>
            provider.id === binding.providerId &&
            provider.models.some((model) => model.id === binding.modelId)
        )
      )
        throw new AppError('invalid_configuration')
    const confirm = await dialog.showMessageBox(window, {
      type: 'question',
      message: text('Import these provider settings?', '导入这些模型配置？'),
      detail: data.providers.map((provider) => `${provider.name}: ${provider.baseUrl}`).join('\n'),
      buttons: [text('Cancel', '取消'), text('Import', '导入')],
      defaultId: 0,
      cancelId: 0
    })
    if (confirm.response !== 1) return null
    service.store.transaction(() => {
      for (const provider of data.providers) service.store.saveProvider({ ...provider, status: 'untested' })
      service.store.saveSettings({ ...data.settings, bounds: service.store.settings().bounds })
    })
    service.onSettings(service.store.settings())
    return service.changed()
  })
}

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', () => {
    if (service) showMain()
  })
  app.on('activate', () => {
    if (service) showMain()
  })
  app.on('before-quit', () => {
    quitting = true
    service?.stop()
  })
  app.on('will-quit', () => globalShortcut.unregisterAll())
  app.on('window-all-closed', () => {
    if (quitting) app.quit()
  })
  void app
    .whenReady()
    .then(() => {
      protocol.handle('prompt-tune', (request) => {
        const url = new URL(request.url)
        const path = resolve(rendererRoot, '.' + decodeURIComponent(url.pathname))
        if (url.hostname !== 'bundle' || !path.startsWith(rendererRoot + sep))
          return new Response('Not found', { status: 404 })
        return net.fetch(pathToFileURL(path).toString())
      })
      mkdirSync(app.getPath('userData'), { recursive: true })
      service = new Service(
        new Store(join(app.getPath('userData'), 'prompt-tune.sqlite')),
        new CredentialVault(app.getPath('userData'), safeStorage),
        app.getVersion(),
        () => app.getLocale()
      )
      service.onState = (state) => broadcast('state-changed', state)
      service.onRun = (event) => broadcast('run-event', event)
      service.onSettings = (settings) => {
        updateTheme(settings)
        registerShortcut(settings)
        mainWindow?.setAlwaysOnTop(settings.alwaysOnTop, 'floating')
        settingsWindow?.setAlwaysOnTop(settings.alwaysOnTop, 'floating')
        updateMenu()
      }
      const icon = nativeImage.createFromPath(join(__dirname, '../../build/trayTemplate.png'))
      if (!icon.isEmpty()) {
        icon.setTemplateImage(true)
        tray = new Tray(icon)
        tray.setToolTip('PromptTune')
        tray.on('click', showMain)
      }
      app.setAboutPanelOptions({
        applicationName: 'PromptTune',
        applicationVersion: app.getVersion(),
        copyright: 'Copyright © 2026 winbeau · MIT',
        website: 'https://github.com/winbeau/prompt-tune'
      })
      updateTheme(service.store.settings())
      nativeTheme.on('updated', () => {
        for (const window of BrowserWindow.getAllWindows())
          window.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#111113' : '#fafafa')
      })
      registerIpc()
      registerShortcut(service.store.settings())
      updateMenu()
      createMain()
      service.kick()
      void service.refreshStaleModels()
      screen.on('display-removed', () => {
        if (mainWindow && !mainWindow.isDestroyed())
          mainWindow.setBounds(visibleBounds({ ...service.store.settings(), bounds: mainWindow.getBounds() }))
      })
    })
    .catch(() => {
      dialog.showErrorBox(
        'PromptTune',
        'PromptTune could not start. Check that its local data directory is writable.'
      )
      app.quit()
    })
}
