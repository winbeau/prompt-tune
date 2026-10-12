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
  if (input === 'Long output probe') {
    result = {
      status: 'completed',
      outputText: 'First line.\nSecond line.\nThird line.\nFourth line.\nFifth line.\nSixth line.',
      changes: [],
      ambiguities: []
    }
  } else if (system.includes('Analyze these PromptTune')) {
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
  for (let i = 0; i < text.length; i += 23) {
    response.write(
      `data: ${JSON.stringify({ choices: [{ delta: { content: text.slice(i, i + 23) }, finish_reason: null }] })}\n\n`
    )
    await new Promise((resolve) => setTimeout(resolve, 3))
  }
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
  await page.locator('#prompt-input').fill('')
  await page.waitForTimeout(350)
  const threeLineHeight = await page
    .locator('#prompt-input')
    .evaluate((el) => Math.ceil(Number.parseFloat(getComputedStyle(el).lineHeight) * 3 + 24))
  assert.equal(await page.locator('#prompt-input').evaluate((el) => getComputedStyle(el).fontSize), '16px')
  await expect(page.getByRole('button', { name: 'Copy prompt' })).toBeDisabled()
  await expect
    .poll(() =>
      page
        .locator('.compact-field')
        .first()
        .evaluate((el) => Math.round(el.getBoundingClientRect().height))
    )
    .toBe(threeLineHeight)
  await expect
    .poll(() =>
      page.locator('.compact-output').evaluate((el) => Math.round(el.getBoundingClientRect().height))
    )
    .toBe(threeLineHeight)
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
  assert.equal(props.bounds.width, 480, 'New windows use the narrower default width')
  assert(props.bounds.height <= 360, 'Empty prompt panel must stay compact with larger default text')
  assert.equal(
    await page.locator('.compact-submit kbd').evaluate((el) => getComputedStyle(el).backgroundColor),
    'rgba(0, 0, 0, 0)'
  )
  if (process.platform === 'darwin') {
    assert.equal(await page.locator('.window-controls button').count(), 2)
    await page.getByRole('button', { name: 'Minimize window', exact: true }).click()
    await expect
      .poll(() => desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized()))
      .toBe(true)
    await desktop.evaluate(({ Menu }) =>
      Menu.getApplicationMenu()
        .items[0].submenu.items.find((item) => item.label === 'Show PromptTune')
        .click()
    )
    await expect
      .poll(() => desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized()))
      .toBe(false)
    checked('Two window controls work: minimize, then restore through Show PromptTune; fullscreen is absent')
  }
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
  await expect(page.getByRole('button', { name: '配置 API key' })).toBeVisible()
  checked('Interface language switches live in both windows')
  await settings.getByRole('combobox').first().selectOption('en')
  const fontSlider = settings.getByRole('slider', { name: 'Text size' })
  await fontSlider.press('End')
  await expect
    .poll(() => page.locator('#prompt-input').evaluate((el) => getComputedStyle(el).fontSize))
    .toBe('24px')
  await expect
    .poll(() => settings.evaluate(() => getComputedStyle(document.documentElement).fontSize))
    .toBe('24px')
  await expect(settings.getByRole('button', { name: 'Larger text', exact: true })).toBeDisabled()
  await settings.screenshot({ path: join(artifactDir, 'settings-large-text.png') })
  await desktop.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((win) => !win.webContents.getURL().includes('settings'))
      .setSize(440, 450)
  )
  await page.locator('#prompt-input').fill('one\ntwo\nthree')
  const largeThreeLineHeight = Math.ceil((24 * 20 * 3) / 13 + 24)
  await expect
    .poll(() =>
      page
        .locator('.compact-field')
        .first()
        .evaluate((el) => Math.round(el.getBoundingClientRect().height))
    )
    .toBe(largeThreeLineHeight)
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
  const rowsFit = await page.evaluate(() => {
    const tagline = document.querySelector('.compact-intro h1').getBoundingClientRect()
    const mode = document.querySelector('.compact-mode').getBoundingClientRect()
    const model = document.querySelector('.model-picker').getBoundingClientRect()
    const actions = document.querySelector('.compact-actions').getBoundingClientRect()
    return tagline.right <= mode.left && model.right <= actions.left
  })
  assert(rowsFit, 'Large text must not overlap the mode switch or run actions at minimum width')
  await page.waitForTimeout(250)
  await page.screenshot({ path: join(artifactDir, 'large-text.png') })
  await fontSlider.press('Home')
  await expect
    .poll(() => page.locator('#prompt-input').evaluate((el) => getComputedStyle(el).fontSize))
    .toBe('12px')
  await expect(settings.getByRole('button', { name: 'Smaller text', exact: true })).toBeDisabled()
  await settings.getByRole('button', { name: 'Reset size', exact: true }).click()
  await expect
    .poll(() => page.locator('#prompt-input').evaluate((el) => getComputedStyle(el).fontSize))
    .toBe('16px')
  await nativeShortcut(true, '=')
  await expect
    .poll(() => page.locator('#prompt-input').evaluate((el) => getComputedStyle(el).fontSize))
    .toBe('17px')
  await nativeShortcut(false, '-')
  await expect
    .poll(() => page.locator('#prompt-input').evaluate((el) => getComputedStyle(el).fontSize))
    .toBe('16px')
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+=' : 'Control+=')
  await expect
    .poll(() => page.locator('#prompt-input').evaluate((el) => getComputedStyle(el).fontSize))
    .toBe('17px')
  await nativeShortcut(true, '0')
  await expect
    .poll(() => page.locator('#prompt-input').evaluate((el) => getComputedStyle(el).fontSize))
    .toBe('16px')
  await page.locator('#prompt-input').fill('')
  await desktop.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((win) => !win.webContents.getURL().includes('settings'))
      .setSize(480, 352)
  )
  checked(
    'Text size adjusts from 12–24px in both windows, native shortcuts work, and narrow layouts remain usable'
  )
  for (const theme of ['light', 'black']) {
    await settings.getByLabel('Color theme').selectOption(theme)
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme)
    await expect.poll(() => settings.evaluate(() => document.documentElement.dataset.theme)).toBe(theme)
    await page.waitForTimeout(250)
    await page.screenshot({ path: join(artifactDir, `compact-${theme}.png`) })
    await settings.screenshot({ path: join(artifactDir, `settings-${theme}.png`) })
  }
  await settings.getByLabel('Color theme').selectOption('system')
  assert.equal((await page.evaluate(() => window.desktop.state())).data.settings.theme, 'system')
  checked('Light, black and system themes synchronize across windows')
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
  await page.locator('#prompt-input').fill('one\ntwo\nthree')
  await expect
    .poll(() =>
      page
        .locator('.compact-field')
        .first()
        .evaluate((el) => Math.round(el.getBoundingClientRect().height))
    )
    .toBe(threeLineHeight)
  await page.locator('#prompt-input').fill('Please explain me this.')
  await page.locator('#prompt-input').fill('one\ntwo\nthree\nfour\nfive')
  await expect
    .poll(() =>
      page
        .locator('.compact-field')
        .first()
        .evaluate((el) => el.getBoundingClientRect().height)
    )
    .toBeGreaterThan(100)
  await page.locator('#prompt-input').fill('Please explain me this.')
  await page.locator('#prompt-input').press('Shift+Enter')
  await expect(page.locator('#prompt-input')).toHaveValue('Please explain me this.\n')
  assert.equal(requests.length, 0)
  await page
    .locator('#prompt-input')
    .evaluate((element) =>
      element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, isComposing: true }))
    )
  assert.equal(requests.length, 0)
  checked('Three-line input grows for longer text; Shift+Return and IME composition do not submit')
  await page.locator('#prompt-input').press('Enter')
  await expect(page.locator('.compact-submit')).toHaveClass(/is-running/)
  await expect(page.getByRole('button', { name: 'Copy prompt' })).toBeDisabled()
  await expect(page.getByTestId('result-text')).toHaveText('Please explain this to me.', { timeout: 15000 })
  await page.getByRole('button', { name: 'Copy prompt' }).click()
  assert.equal(
    await desktop.evaluate(async ({ clipboard }) => await clipboard.readText()),
    'Please explain this to me.'
  )
  assert.deepEqual(requests[0].thinking, { type: 'disabled' })
  checked('Tune runs with Return and copies only the corrected prompt')
  const beforeLongProbe = (await page.evaluate(() => window.desktop.state())).data
  await page.evaluate(
    (settings) => window.desktop.saveSettings({ ...settings, saveHistory: false }),
    beforeLongProbe.settings
  )
  await page.locator('#prompt-input').fill('Long output probe')
  await page.locator('#prompt-input').press('Enter')
  await expect(page.getByTestId('result-text')).toContainText('Sixth line.')
  await expect
    .poll(() => page.locator('.compact-output').evaluate((el) => el.getBoundingClientRect().height))
    .toBeGreaterThan(130)
  assert.equal((await page.evaluate(() => window.desktop.state())).data.historyCount, 1)
  await page.evaluate((settings) => window.desktop.saveSettings(settings), beforeLongProbe.settings)
  checked('Output grows beyond three lines; disabling history excludes a round from summaries')
  await page.getByRole('switch', { name: 'Translate Chinese to English' }).click()
  await page.locator('#prompt-input').fill('修复 bug，不要改动 `user_id`。')
  await page.getByRole('button', { name: 'Translate prompt', exact: true }).click()
  await expect(page.getByTestId('result-text')).toHaveText('Fix the bug without changing `user_id`.', {
    timeout: 15000
  })
  checked('CN→EN translation uses its own prompt and preserves technical identifiers')
  await page.getByRole('switch', { name: 'Translate Chinese to English' }).click()
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
  const tuneColor = await management
    .locator('.history-mode.tune')
    .first()
    .evaluate((el) => getComputedStyle(el).backgroundColor)
  const translateColor = await management
    .locator('.history-mode.translate')
    .first()
    .evaluate((el) => getComputedStyle(el).backgroundColor)
  assert.notEqual(tuneColor, translateColor)
  assert(
    await management
      .locator('.settings-tabs .selected')
      .evaluate((el) => Number.parseFloat(getComputedStyle(el).paddingLeft) >= 14)
  )
  for (const theme of ['light', 'black']) {
    await management.evaluate(async (theme) => {
      const reply = await window.desktop.state()
      await window.desktop.saveSettings({ ...reply.data.settings, theme })
    }, theme)
    await management.waitForTimeout(200)
    await management.screenshot({ path: join(artifactDir, `history-${theme}.png`) })
  }
  await management.evaluate(async () => {
    const reply = await window.desktop.state()
    await window.desktop.saveSettings({ ...reply.data.settings, theme: 'system' })
  })
  checked(
    'Settings tabs have comfortable padding; Tune and Translate use distinct colored capsules in both themes'
  )
  await management.getByRole('button', { name: 'My patterns', exact: true }).click()
  await expect(management.getByText('9 occurrences')).toBeVisible()
  await management.getByRole('button', { name: 'View source prompts (9)' }).click()
  await expect(management.locator('.evidence-card')).toHaveCount(9)
  await management.screenshot({ path: join(artifactDir, 'patterns.png') })
  checked('History and evidence-backed pattern summaries render in the management window')
  await management.getByRole('button', { name: 'General', exact: true }).click()
  await management.evaluate(async () => {
    const reply = await window.desktop.state()
    await window.desktop.saveSettings({ ...reply.data.settings, fontSize: 18 })
  })
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
  assert.equal(reopenedState.settings.fontSize, 18)
  await expect
    .poll(() => reopened.locator('#prompt-input').evaluate((el) => getComputedStyle(el).fontSize))
    .toBe('18px')
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
