import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  AppError,
  providerSchema,
  settingsSchema,
  type AppState,
  type Binding,
  type HistoryItem,
  type Insight,
  type Locale,
  type PromptResult,
  type Provider,
  type RunEvent,
  type RunInput,
  type Settings,
  type Task
} from '../shared/types'
import { classifyError, discover, generate } from './models'
import { parseResult, partialOutput, summaryPrompt, systemPrompt, TEMPLATE_VERSION } from './prompts'
import { CredentialVault, Store, type SummaryInsight } from './storage'

const summarySchema = z.object({
  insights: z
    .array(
      z.object({
        pattern: z.string().min(1).max(150),
        title: z.string().min(1).max(150),
        category: z.enum(['grammar', 'word_choice', 'collocation', 'clarity']),
        explanation: z.string().max(3000),
        from: z.string().min(1).max(4000),
        to: z.string().min(1).max(4000),
        evidence: z
          .array(z.object({ historyId: z.string(), from: z.string().min(1), to: z.string().min(1) }))
          .max(100)
      })
    )
    .max(12)
})

export class Service {
  foreground: { id: string; controller: AbortController } | undefined
  private background: { id: string; controller: AbortController } | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  shortcutError = false
  stopped = false
  onState: (state: AppState) => void = () => {}
  onRun: (event: RunEvent) => void = () => {}
  onSettings: (settings: Settings) => void = () => {}
  constructor(
    readonly store: Store,
    readonly vault: CredentialVault,
    private version: string,
    private systemLocale: () => string
  ) {}
  locale(): Locale {
    const lang = this.store.settings().language
    return lang === 'system' ? (this.systemLocale().startsWith('zh') ? 'zh-CN' : 'en') : lang
  }
  explanationLocale(): Locale {
    const lang = this.store.settings().explanationLanguage
    return lang === 'ui' ? this.locale() : lang
  }
  state(): AppState {
    return {
      settings: this.store.settings(),
      locale: this.locale(),
      providers: this.store
        .providers()
        .map((provider) => ({ ...provider, hasKey: this.vault.has(provider.id) })),
      version: this.version,
      historyCount: this.store.historyCount(),
      summaryPendingCount: this.store.pendingCount(),
      jobs: this.store.jobs(),
      shortcutError: this.shortcutError,
      credentialPersistence: this.vault.persistent
    }
  }
  changed(): AppState {
    const state = this.state()
    this.onState(state)
    return state
  }
  saveSettings(value: unknown): AppState {
    const settings = settingsSchema.parse(value)
    this.store.saveSettings(settings)
    if (!settings.autoSummary || !settings.saveHistory) this.background?.controller.abort()
    this.onSettings(settings)
    this.store.transaction(() => this.store.enqueue(false))
    this.kick()
    return this.changed()
  }
  async saveProvider(value: unknown, key?: string): Promise<AppState> {
    const provider = providerSchema.parse(value)
    if (key !== undefined) {
      if (!key.trim() || key.length > 4096 || /[\r\n]/.test(key)) throw new AppError('invalid_key')
      this.vault.set(provider.id, key.trim())
    }
    provider.status = 'untested'
    this.store.saveProvider(provider)
    this.changed()
    if (provider.preset === 'deepseek' && key) {
      await this.refreshModels(provider.id)
    }
    this.kick()
    return this.changed()
  }
  removeProvider(id: string): AppState {
    const settings = this.store.settings()
    if (Object.values(settings.bindings).some((binding) => binding.providerId === id))
      throw new AppError('provider_in_use')
    this.vault.remove(id)
    this.store.removeProvider(id)
    return this.changed()
  }
  removeKey(id: string): AppState {
    this.vault.remove(id)
    this.background?.controller.abort()
    return this.changed()
  }
  async refreshModels(id: string): Promise<AppState> {
    const provider = this.store.provider(id)
    if (!provider) throw new AppError('model_not_found')
    try {
      provider.models = await discover(provider, this.vault.get(id))
      provider.refreshedAt = new Date().toISOString()
      provider.status = 'ready'
      this.store.saveProvider(provider)
      const settings = this.store.settings()
      const fallback =
        provider.models.find(
          (model) =>
            !model.missing && model.enabled && model.id.includes('flash') && model.protocol !== 'unsupported'
        ) ??
        provider.models.find((model) => !model.missing && model.enabled && model.protocol !== 'unsupported')
      if (fallback) {
        for (const task of ['translate', 'tune', 'summarize'] as Task[]) {
          if (
            provider.preset === 'deepseek' &&
            settings.bindings[task].providerId === id &&
            !provider.models.some((model) => model.id === settings.bindings[task].modelId && !model.missing)
          )
            settings.bindings[task].modelId = fallback.id
        }
        this.store.saveSettings(settings)
      }
      this.kick()
      return this.changed()
    } catch (error) {
      const code = classifyError(error)
      provider.status = code.code === 'auth_error' ? 'auth_error' : 'error'
      this.store.saveProvider(provider)
      this.changed()
      throw code
    }
  }
  resolve(task: Task, override?: Binding) {
    const binding = override ?? this.store.settings().bindings[task]
    const provider = this.store.provider(binding.providerId)
    const model = provider?.models.find((model) => model.id === binding.modelId)
    if (!provider || !model) throw new AppError('model_not_found')
    if (model.protocol === 'unsupported') throw new AppError('unsupported_protocol')
    return { provider, model, key: this.vault.get(provider.id), binding }
  }
  async testProvider(id: string): Promise<AppState> {
    await this.refreshModels(id)
    return this.state()
  }
  async refreshStaleModels(): Promise<void> {
    for (const provider of this.store.providers()) {
      if (this.stopped) break
      if (!provider.enabled || (provider.requiresKey && !this.vault.has(provider.id))) continue
      if (provider.refreshedAt && Date.now() - Date.parse(provider.refreshedAt) < 86400000) continue
      try {
        await this.refreshModels(provider.id)
      } catch {
        /* Keep cached models usable; the provider status records failure. */
      }
    }
  }
  run(value: unknown): null {
    const input = z
      .object({
        id: z.string().uuid(),
        mode: z.enum(['translate', 'tune']),
        text: z.string().trim().min(1).max(20000),
        save: z.boolean(),
        binding: z.object({ providerId: z.string(), modelId: z.string() }).optional()
      })
      .parse(value)
    if (this.foreground) throw new AppError('busy')
    const resolved = this.resolve(input.mode, input.binding)
    if (resolved.provider.requiresKey && !resolved.key) throw new AppError('missing_key')
    this.background?.controller.abort()
    const controller = new AbortController()
    this.foreground = { id: input.id, controller }
    void this.process(input, resolved, controller)
    return null
  }
  private async process(
    input: RunInput,
    resolved: ReturnType<Service['resolve']>,
    controller: AbortController
  ): Promise<void> {
    const start = Date.now()
    const locale = this.explanationLocale()
    let result: PromptResult | undefined
    const attemptId = randomUUID()
    try {
      let generated = await generate({
        ...resolved,
        system: systemPrompt(input.mode, locale),
        user: input.text,
        signal: controller.signal,
        onDelta: (json) => {
          const text = partialOutput(json)
          if (text !== undefined) this.onRun({ id: input.id, type: 'preview', text })
        }
      })
      try {
        result = parseResult(generated.content, input.text, input.mode)
      } catch (error) {
        if (!(error instanceof AppError) || error.code !== 'invalid_result') throw error
        this.store.recordAttempt(
          attemptId,
          input.mode,
          resolved.provider.id,
          resolved.model.id,
          'invalid_result',
          { usage: generated.usage, template: TEMPLATE_VERSION }
        )
        generated = await generate({
          ...resolved,
          system:
            systemPrompt(input.mode, locale) +
            '\nThe previous response did not match the JSON schema. Return the complete required JSON object with status, outputText, changes and ambiguities.',
          user: input.text,
          signal: controller.signal
        })
        result = parseResult(generated.content, input.text, input.mode)
      }
      controller.signal.throwIfAborted()
      this.store.recordAttempt(
        randomUUID(),
        input.mode,
        resolved.provider.id,
        resolved.model.id,
        'completed',
        { usage: generated.usage, template: TEMPLATE_VERSION }
      )
      if (result.status === 'completed' && input.save && this.store.settings().saveHistory) {
        const previous = this.store.historyItem(input.id)
        const item: HistoryItem = {
          id: input.id,
          mode: input.mode,
          input: input.text,
          result,
          locale,
          binding: resolved.binding,
          usage: generated.usage,
          elapsedMs: Date.now() - start,
          createdAt: previous?.createdAt ?? new Date().toISOString()
        }
        this.store.saveHistory(item)
      }
      this.onRun({ id: input.id, type: 'done', result })
      this.changed()
    } catch (error) {
      const classified = classifyError(error, controller.signal)
      this.store.recordAttempt(
        attemptId,
        input.mode,
        resolved.provider.id,
        resolved.model.id,
        classified.code,
        { template: TEMPLATE_VERSION }
      )
      this.onRun({ id: input.id, type: 'error', error: classified.code })
    } finally {
      this.foreground = undefined
      this.kick()
    }
  }
  cancel(id: string): null {
    if (this.foreground?.id === id) this.foreground.controller.abort()
    return null
  }
  deleteHistory(id: string): null {
    this.background?.controller.abort()
    this.store.deleteHistory(id)
    this.changed()
    this.kick()
    return null
  }
  clearHistory(): null {
    this.background?.controller.abort()
    this.store.clearHistory()
    this.changed()
    return null
  }
  rejectChange(id: string, from: string): null {
    this.background?.controller.abort()
    this.store.rejectChange(id, from)
    this.changed()
    this.kick()
    return null
  }
  insightStatus(id: string, status: Insight['status']): null {
    this.store.insightStatus(id, status)
    this.changed()
    return null
  }
  summarize(): null {
    this.store.transaction(() => this.store.enqueue(true))
    this.kick(true)
    this.changed()
    return null
  }
  retrySummary(id: string): null {
    this.store.retryJob(id)
    this.kick(true)
    this.changed()
    return null
  }
  kick(manual = false): void {
    clearTimeout(this.timer)
    if (this.stopped) return
    this.timer = setTimeout(() => void this.pump(manual), 500)
  }
  private async pump(manual = false): Promise<void> {
    if (this.stopped || this.foreground || this.background) {
      if (!this.stopped) this.kick(manual)
      return
    }
    const settings = this.store.settings()
    if (!manual && (!settings.autoSummary || !settings.saveHistory)) return
    const job = this.store.nextJob()
    if (!job) {
      this.timer = setTimeout(() => this.kick(), 15000)
      return
    }
    if (this.store.summaryCallsToday() >= settings.summaryDailyLimit) {
      this.timer = setTimeout(() => this.kick(manual), 60000)
      return
    }
    const controller = new AbortController()
    this.background = { id: job.id, controller }
    const attemptId = randomUUID()
    try {
      const resolved = this.resolve('summarize')
      const locale = this.explanationLocale()
      this.store.setJob(job.id, 'running')
      this.changed()
      const source = this.store.jobItems(job.id)
      const items = source.map((item) => ({
        id: item.id,
        mode: item.mode,
        changes: [] as PromptResult['changes']
      }))
      const candidates = source.map((item) =>
        item.mode === 'tune'
          ? item.result.changes
              .filter((change) => change.kind === 'correction' && change.confidence >= 0.7)
              .slice(0, 15)
          : []
      )
      const budget = Math.max(
        1024,
        Math.min(24000, (resolved.model.contextWindow ?? 65536) - (resolved.model.maxOutput ?? 8192) - 2048)
      )
      // Add complete evidence in round-robin order; never truncate a source/target quotation.
      for (let index = 0; index < 15; index++)
        for (let row = 0; row < items.length; row++) {
          const change = candidates[row][index]
          if (!change) continue
          items[row].changes.push({ ...change, reason: change.reason.slice(0, 200) })
          if (JSON.stringify({ records: items }).length > budget) items[row].changes.pop()
        }
      this.store.recordAttempt(attemptId, 'summarize', resolved.provider.id, resolved.model.id, 'running', {})
      const generated = await generate({
        ...resolved,
        system: summaryPrompt(locale),
        user: JSON.stringify({ records: items }),
        signal: controller.signal,
        retries: 0
      })
      controller.signal.throwIfAborted()
      let proposals: SummaryInsight[]
      try {
        proposals = summarySchema.parse(
          JSON.parse(generated.content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''))
        ).insights
      } catch {
        throw new AppError('invalid_result')
      }
      this.store.completeJob(job.id, proposals, locale)
      this.store.recordAttempt(attemptId, 'summarize', resolved.provider.id, resolved.model.id, 'completed', {
        usage: generated.usage,
        template: TEMPLATE_VERSION
      })
    } catch (error) {
      const classified = classifyError(error, controller.signal)
      if (classified.code === 'canceled') this.store.setJob(job.id, 'pending')
      else {
        const canRetry = classified.retryable && job.attempts < 2
        this.store.setJob(
          job.id,
          canRetry ? 'retry_wait' : 'failed',
          classified.code,
          Date.now() + 30000 * 2 ** job.attempts
        )
      }
    } finally {
      this.background = undefined
      if (!this.stopped) {
        this.changed()
        this.kick(manual)
      }
    }
  }
  stop(): void {
    this.stopped = true
    clearTimeout(this.timer)
    this.foreground?.controller.abort()
    this.background?.controller.abort()
  }
}
