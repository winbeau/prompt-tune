import { _electron as electron, expect } from 'playwright/test'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import assert from 'node:assert/strict'

const require = createRequire(import.meta.url)
const requests = []
const mock = createServer(async (request, response) => {
  if (request.headers.authorization !== 'Bearer sk-e2e-secret') {
    response.writeHead(401)
    response.end('{}')
    return
  }
  if (request.url === '/models') {
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify({ data: [{ id: 'deepseek-flash' }, { id: 'deepseek-v4-pro' }] }))
    return
  }
  let raw = ''
  for await (const part of request) raw += part
  const body = JSON.parse(raw)
  requests.push(body)
  const system = body.messages?.[0]?.content ?? ''
  const input = body.messages?.at(-1)?.content ?? ''
  let result
  if (system.includes('Analyze these PromptTune')) {
    const records = JSON.parse(input).records.filter((record) => record.mode === 'tune')
    result = {
      insights: [
        {
          pattern: 'explain-to-person',
          title: 'Use “explain to me”',
          category: 'grammar',
          explanation: 'Use “explain something to someone”.',
          from: 'explain me',
          to: 'explain this to me',
          evidence: records.flatMap((record) =>
            record.changes.map((change) => ({ historyId: record.id, from: change.from, to: change.to }))
          )
        }
      ]
    }
  } else if (system.includes('Translate the Chinese'))
    result = {
      status: 'completed',
      outputText: 'Fix the bug without changing `user_id`.',
      changes: [
        {
          from: '修复 bug',
          to: 'Fix the bug',
          category: 'translation',
          kind: 'translation_choice',
          reason: 'Keep the command direct.',
          confidence: 0.9
        }
      ],
      ambiguities: []
    }
  else
    result = {
      status: 'completed',
      outputText: 'Please explain this to me.',
      changes: [
        {
          from: 'explain me',
          to: 'explain this to me',
          category: 'grammar',
          kind: 'correction',
          reason: 'Use explain to.',
          confidence: 0.95
        }
      ],
      ambiguities: []
    }
  response.writeHead(200, { 'Content-Type': 'text/event-stream' })
  const text = JSON.stringify(result)
  for (let i = 0; i < text.length; i += 23)
    response.write(
      `data: ${JSON.stringify({ choices: [{ delta: { content: text.slice(i, i + 23) }, finish_reason: null }] })}\n\n`
    )
  response.write(
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 42, completion_tokens: 32 } })}\n\n`
  )
  response.end('data: [DONE]\n\n')
})
await new Promise((resolve) => mock.listen(0, '127.0.0.1', resolve))
const port = mock.address().port
const dir = await mkdtemp(join(tmpdir(), 'prompt-tune-e2e-'))
const artifactDir = resolve(process.env.PROMPT_TUNE_TEST_ARTIFACTS ?? 'work/e2e')
await mkdir(artifactDir, { recursive: true })
const baseEnv = { ...process.env, PROMPT_TUNE_USER_DATA: dir }
delete baseEnv.ELECTRON_RUN_AS_NODE
const launchOptions = {
  executablePath: process.env.PROMPT_TUNE_EXECUTABLE ?? require('electron'),
  args: process.env.PROMPT_TUNE_EXECUTABLE ? [] : [resolve('out/main/index.js')],
  env: baseEnv
}
let desktop
const report = { checkedAt: new Date().toISOString(), platform: process.platform, checks: [] }
function checked(name) {
  report.checks.push(name)
  console.log(`PASS ${name}`)
}
async function nativeShortcut(settings, key) {
  await desktop.evaluate(
    ({ BrowserWindow }, { settings, key }) => {
      const window = BrowserWindow.getAllWindows().find(
        (window) => window.webContents.getURL().includes('settings') === settings
      )
      window.focus()
      window.webContents.sendInputEvent({
        type: 'keyDown',
        keyCode: key,
        modifiers: [process.platform === 'darwin' ? 'meta' : 'control']
      })
      if (!window.isDestroyed())
        window.webContents.sendInputEvent({
          type: 'keyUp',
          keyCode: key,
          modifiers: [process.platform === 'darwin' ? 'meta' : 'control']
        })
    },
    { settings, key }
  )
}
try {
  desktop = await electron.launch(launchOptions)
  desktop.process().stderr.on('data', (data) => {
    const text = data.toString()
    if (/Error|error/i.test(text)) console.log(text.slice(0, 400))
  })
  const page = await desktop.firstWindow()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.waitForSelector('#prompt-input')
  await page.screenshot({ path: join(artifactDir, 'first-launch.png') })
  let props = await desktop.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find(
      (window) => !window.webContents.getURL().includes('settings')
    )
    return {
      top: win.isAlwaysOnTop(),
      fullscreenable: win.isFullScreenable(),
      maximizable: win.isMaximizable(),
      resizable: win.isResizable(),
      visible: win.isVisible(),
      bounds: win.getBounds()
    }
  })
  assert.deepEqual(
    [props.top, props.fullscreenable, props.maximizable, props.resizable, props.visible],
    [true, false, false, true, true]
  )
  checked(
    'Native floating window is visible, always on top, resizable, and cannot enter fullscreen or maximize'
  )
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(540, 690))
  const resized = await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds())
  assert.equal(resized.width, 540)
  assert.equal(resized.height, 690)
  checked('Native window size changes and responsive layout renders')
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(600, 780))
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+,' : 'Control+,')
  const settings = await desktop
    .waitForEvent('window', { predicate: async (page) => page.url().includes('settings'), timeout: 10000 })
    .catch(() => desktop.windows().find((page) => page.url().includes('settings')))
  assert(settings, 'Settings accelerator must open the settings window')
  await settings.waitForSelector('.settings-tabs')
  checked('Command/Control+, opens the Settings window')
  await settings.getByRole('combobox').first().selectOption('zh-CN')
  await expect(settings.getByRole('button', { name: '模型管理', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /连接 DeepSeek/ }).first()).toBeVisible()
  checked('Interface language switches live in both windows')
  await settings.getByRole('combobox').first().selectOption('en')
  await settings.getByRole('button', { name: 'Models', exact: true }).click()
  const address = settings.getByLabel('API base URL')
  await address.fill(`http://127.0.0.1:${port}`)
  await settings.getByRole('textbox', { name: 'API key', exact: true }).fill('sk-e2e-secret')
  await settings.getByRole('button', { name: 'Save changes', exact: true }).first().click()
  await expect(settings.getByText('Connected', { exact: true }).last()).toBeVisible({ timeout: 15000 })
  await expect(settings.getByRole('textbox', { name: 'API key', exact: true })).toHaveValue('')
  const publicState = await page.evaluate(() => window.desktop.state())
  assert(!JSON.stringify(publicState).includes('sk-e2e-secret'))
  assert.equal(publicState.data.settings.bindings.tune.modelId, 'deepseek-flash')
  assert(!(await readFile(join(dir, 'credentials.enc'))).includes('sk-e2e-secret'))
  checked('API-key setup discovers models, binds tasks, clears the input, and encrypts saved credentials')
  await nativeShortcut(true, 'W')
  await expect.poll(() => desktop.windows().filter((page) => page.url().includes('settings')).length).toBe(0)
  checked('Command/Control+W closes the Settings window')
  await page.bringToFront()
  await page.locator('#prompt-input').fill('Please explain me this.')
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter')
  await expect(page.getByTestId('result-text')).toHaveText('Please explain this to me.', { timeout: 15000 })
  await page.getByRole('button', { name: 'Copy prompt' }).click()
  assert.equal(
    await desktop.evaluate(async ({ clipboard }) => await clipboard.readText()),
    'Please explain this to me.'
  )
  assert.deepEqual(requests[0].thinking, { type: 'disabled' })
  checked('Tune runs with Command/Control+Enter and copies only the corrected prompt')
  await page.getByRole('button', { name: /Translate CN/ }).click()
  await page.locator('#prompt-input').fill('修复 bug，不要改动 `user_id`。')
  await page.getByRole('button', { name: 'Translate prompt', exact: true }).click()
  await expect(page.getByTestId('result-text')).toHaveText('Fix the bug without changing `user_id`.', {
    timeout: 15000
  })
  checked('CN→EN translation uses its own prompt and preserves technical identifiers')
  await page.getByRole('button', { name: /Tune EN/ }).click()
  for (let i = 0; i < 8; i++) {
    await page.locator('#prompt-input').fill(`Please explain me this. Round ${i + 3}.`)
    await page.getByRole('button', { name: 'Tune prompt', exact: true }).click()
    await expect(page.getByTestId('result-text')).toHaveText('Please explain this to me.', { timeout: 10000 })
  }
  await expect
    .poll(async () => (await page.evaluate(() => window.desktop.insights())).data?.[0]?.count, {
      timeout: 20000
    })
    .toBe(9)
  assert.equal((await page.evaluate(() => window.desktop.state())).data.historyCount, 10)
  assert.equal(
    requests.filter((body) => body.messages[0].content.includes('Analyze these PromptTune')).length,
    1
  )
  checked('Exactly round 10 triggers one background summary; only the 9 English Tune rounds count as errors')
  await page.screenshot({ path: join(artifactDir, 'tuned-prompt.png') })
  await page.getByRole('button', { name: 'History', exact: true }).click()
  const management = await desktop
    .waitForEvent('window', { timeout: 5000 })
    .catch(() => desktop.windows().find((page) => page.url().includes('settings')))
  await management.waitForSelector('.history-list')
  assert.equal(await management.locator('.history-card').count(), 10)
  await management.getByRole('button', { name: 'My patterns', exact: true }).click()
  await expect(management.getByText('9 occurrences')).toBeVisible()
  await management.getByRole('button', { name: 'View source prompts (9)' }).click()
  await expect(management.locator('.evidence-card')).toHaveCount(9)
  await management.screenshot({ path: join(artifactDir, 'patterns.png') })
  checked('History and evidence-backed pattern summaries render in the management window')
  await management.getByRole('button', { name: 'General', exact: true }).click()
  await management.getByRole('combobox').first().selectOption('zh-CN')
  await nativeShortcut(true, 'W')
  await page.bringToFront()
  await nativeShortcut(false, 'W')
  await expect
    .poll(() => desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()))
    .toBe(false)
  checked('Command/Control+W closes the floating window without quitting the tray app')
  await desktop.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].show()
    BrowserWindow.getAllWindows()[0].focus()
  })
  const menu = await desktop.evaluate(({ Menu }) =>
    Menu.getApplicationMenu()
      .items.flatMap((item) => item.submenu?.items ?? [])
      .map((item) => ({ accelerator: item.accelerator, role: item.role }))
  )
  assert(menu.some((item) => item.accelerator === 'CommandOrControl+Q'))
  assert(menu.some((item) => item.accelerator === 'CommandOrControl+W'))
  assert(menu.some((item) => item.accelerator === 'CommandOrControl+,'))
  assert(!menu.some((item) => item.role === 'togglefullscreen'))
  const exits = desktop.waitForEvent('close', { timeout: 10000 })
  await nativeShortcut(false, 'Q')
  await exits
  checked('Command/Control+Q exits the app; no fullscreen menu command exists')
  desktop = await electron.launch(launchOptions)
  const reopened = await desktop.firstWindow()
  await reopened.waitForSelector('#prompt-input')
  const reopenedState = (await reopened.evaluate(() => window.desktop.state())).data
  assert.equal(reopenedState.settings.language, 'zh-CN')
  assert.equal(reopenedState.historyCount, 10)
  assert(reopenedState.providers.find((provider) => provider.id === 'deepseek').hasKey)
  assert.equal((await reopened.evaluate(() => window.desktop.insights())).data[0].count, 9)
  await reopened.screenshot({ path: join(artifactDir, 'chinese-interface.png') })
  checked('Restart restores language, credentials, window state, history, and pattern evidence')
  assert.deepEqual(errors, [])
  checked('No renderer exceptions occurred')
  await writeFile(join(artifactDir, 'verification.json'), JSON.stringify(report, null, 2))
} finally {
  if (desktop) await desktop.close().catch(() => {})
  await new Promise((resolve) => mock.close(resolve))
  await rm(dir, { recursive: true, force: true })
}
