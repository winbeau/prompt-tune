import { z } from 'zod'

export const protocolSchema = z.enum(['chat-completions', 'responses', 'messages', 'unsupported'])
export type Protocol = z.infer<typeof protocolSchema>
export const modeSchema = z.enum(['translate', 'tune'])
export type Mode = z.infer<typeof modeSchema>
export type Task = Mode | 'summarize'
export type Locale = 'en' | 'zh-CN'

export const modelSchema = z.object({
  id: z.string().trim().min(1).max(200),
  name: z.string().max(200),
  protocol: protocolSchema,
  enabled: z.boolean().default(true),
  favorite: z.boolean().default(false),
  source: z.enum(['preset', 'discovered', 'manual']).default('manual'),
  jsonMode: z.boolean().default(false),
  streaming: z.boolean().optional(),
  maxTokensField: z.enum(['max_tokens', 'max_completion_tokens']).optional(),
  contextWindow: z.number().positive().optional(),
  maxOutput: z.number().positive().optional(),
  missing: z.boolean().optional()
})
export type Model = z.infer<typeof modelSchema>

const endpointSchema = z
  .string()
  .trim()
  .url()
  .max(500)
  .refine((value) => {
    const url = new URL(value)
    return (
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      (url.protocol === 'https:' ||
        (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
    )
  }, 'Use HTTPS, or HTTP for a local server. Do not include credentials, query strings, or fragments.')

export const providerSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
  name: z.string().trim().min(1).max(100),
  preset: z.enum(['deepseek', 'opencode', 'opencode-go', 'custom']),
  baseUrl: endpointSchema,
  protocol: protocolSchema.exclude(['unsupported']),
  enabled: z.boolean(),
  requiresKey: z.boolean(),
  models: z.array(modelSchema).max(1000),
  timeoutMs: z.number().int().min(5000).max(300000),
  status: z.enum(['untested', 'ready', 'auth_error', 'error']),
  refreshedAt: z.string().optional()
})
export type Provider = z.infer<typeof providerSchema>
export type PublicProvider = Provider & { hasKey: boolean }
export type Binding = { providerId: string; modelId: string }

export const settingsSchema = z.object({
  language: z.enum(['system', 'en', 'zh-CN']),
  explanationLanguage: z.enum(['ui', 'en', 'zh-CN']),
  shortcut: z.string().min(1).max(100),
  alwaysOnTop: z.boolean(),
  saveHistory: z.boolean(),
  autoSummary: z.boolean(),
  summaryEvery: z.number().int().min(2).max(100),
  summaryDailyLimit: z.number().int().min(1).max(1000),
  bindings: z.object({
    translate: z.object({ providerId: z.string(), modelId: z.string() }),
    tune: z.object({ providerId: z.string(), modelId: z.string() }),
    summarize: z.object({ providerId: z.string(), modelId: z.string() })
  }),
  bounds: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).optional()
})
export type Settings = z.infer<typeof settingsSchema>

export const changeSchema = z.object({
  from: z.string().max(4000),
  to: z.string().max(4000),
  category: z.enum(['grammar', 'word_choice', 'collocation', 'clarity', 'style', 'translation']),
  kind: z.enum(['correction', 'style_suggestion', 'translation_choice']),
  reason: z.string().max(2000),
  confidence: z.number().min(0).max(1).default(0.8)
})
export const resultSchema = z
  .object({
    status: z.enum(['completed', 'needs_clarification']),
    outputText: z.string().max(100000).nullable(),
    changes: z.array(changeSchema).max(100),
    ambiguities: z.array(z.string().max(2000)).max(20)
  })
  .superRefine((result, context) => {
    if (result.status === 'completed' && !result.outputText?.trim())
      context.addIssue({ code: 'custom', message: 'Completed results must contain text.' })
    if (result.status === 'needs_clarification' && !result.ambiguities.length)
      context.addIssue({ code: 'custom', message: 'Clarification must explain the ambiguity.' })
  })
export type PromptResult = z.infer<typeof resultSchema>
export type Usage = { input: number | null; output: number | null }
export type HistoryItem = {
  id: string
  mode: Mode
  input: string
  result: PromptResult
  createdAt: string
  binding: Binding
  locale: Locale
  usage: Usage
  elapsedMs: number
}
export type Insight = {
  id: string
  pattern: string
  title: string
  category: string
  explanation: string
  from: string
  to: string
  count: number
  status: 'active' | 'mastered' | 'ignored'
  locale: Locale
  updatedAt: string
  historyIds: string[]
}
export type Job = {
  id: string
  status: string
  attempts: number
  error: string | null
  createdAt: string
  nextRunAt: number
}
export type AppState = {
  settings: Settings
  locale: Locale
  providers: PublicProvider[]
  version: string
  historyCount: number
  summaryPendingCount: number
  jobs: Job[]
  shortcutError: boolean
  credentialPersistence: boolean
}
export type RunInput = { id: string; mode: Mode; text: string; save: boolean; binding?: Binding }
export type RunEvent = {
  id: string
  type: 'preview' | 'done' | 'error'
  text?: string
  result?: PromptResult
  error?: string
}
export type Reply<T> = { ok: true; data: T } | { ok: false; error: string }
export type DesktopAPI = {
  state(): Promise<Reply<AppState>>
  saveSettings(settings: Settings): Promise<Reply<AppState>>
  saveProvider(provider: Provider, key?: string): Promise<Reply<AppState>>
  removeProvider(id: string): Promise<Reply<AppState>>
  removeKey(id: string): Promise<Reply<AppState>>
  refreshModels(id: string): Promise<Reply<AppState>>
  testProvider(id: string): Promise<Reply<AppState>>
  run(input: RunInput): Promise<Reply<null>>
  cancel(id: string): Promise<Reply<null>>
  history(query: string): Promise<Reply<HistoryItem[]>>
  historyItems(ids: string[]): Promise<Reply<HistoryItem[]>>
  deleteHistory(id: string): Promise<Reply<null>>
  clearHistory(): Promise<Reply<null>>
  insights(): Promise<Reply<Insight[]>>
  insightStatus(id: string, status: Insight['status']): Promise<Reply<null>>
  rejectChange(historyId: string, from: string): Promise<Reply<null>>
  summarize(): Promise<Reply<null>>
  retrySummary(id: string): Promise<Reply<null>>
  exportData(kind: 'history' | 'config'): Promise<Reply<boolean>>
  importConfig(): Promise<Reply<AppState | null>>
  openSettings(tab?: string): Promise<Reply<null>>
  closeWindow(): Promise<Reply<null>>
  copy(text: string): Promise<Reply<null>>
  paste(): Promise<Reply<string>>
  onState(listener: (state: AppState) => void): () => void
  onRun(listener: (event: RunEvent) => void): () => void
}

export class AppError extends Error {
  constructor(
    public code: string,
    public retryable = false,
    public retryAfterMs?: number
  ) {
    super(code)
  }
}

export const defaultSettings: Settings = {
  language: 'system',
  explanationLanguage: 'ui',
  shortcut: 'CommandOrControl+Shift+Space',
  alwaysOnTop: true,
  saveHistory: true,
  autoSummary: true,
  summaryEvery: 10,
  summaryDailyLimit: 20,
  bindings: {
    translate: { providerId: 'deepseek', modelId: 'deepseek-flash' },
    tune: { providerId: 'deepseek', modelId: 'deepseek-flash' },
    summarize: { providerId: 'deepseek', modelId: 'deepseek-flash' }
  }
}

export const presets: Provider[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    preset: 'deepseek',
    baseUrl: 'https://api.deepseek.com',
    protocol: 'chat-completions',
    enabled: true,
    requiresKey: true,
    timeoutMs: 120000,
    status: 'untested',
    models: [
      {
        id: 'deepseek-flash',
        name: 'DeepSeek Flash',
        protocol: 'chat-completions',
        enabled: true,
        favorite: true,
        source: 'preset',
        jsonMode: true
      },
      {
        id: 'deepseek-v4-pro',
        name: 'DeepSeek V4 Pro',
        protocol: 'chat-completions',
        enabled: true,
        favorite: false,
        source: 'preset',
        jsonMode: true
      }
    ]
  },
  {
    id: 'opencode',
    name: 'OpenCode Zen',
    preset: 'opencode',
    baseUrl: 'https://opencode.ai/zen/v1',
    protocol: 'chat-completions',
    enabled: true,
    requiresKey: true,
    timeoutMs: 120000,
    status: 'untested',
    models: []
  },
  {
    id: 'opencode-go',
    name: 'OpenCode Go',
    preset: 'opencode-go',
    baseUrl: 'https://opencode.ai/zen/go/v1',
    protocol: 'chat-completions',
    enabled: true,
    requiresKey: true,
    timeoutMs: 120000,
    status: 'untested',
    models: []
  }
]
