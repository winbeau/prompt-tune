import { AppError, modelSchema, type Model, type Provider, type Usage } from '../shared/types'
import catalog from './catalog/opencode.json'

export const endpoint = (base: string, path: string): string =>
  `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`

export function detectProtocol(
  preset: Provider['preset'],
  metadata: Record<string, unknown>,
  fallback: Model['protocol']
): Model['protocol'] {
  if (preset === 'deepseek') return 'chat-completions'
  if (preset === 'custom') return fallback
  const api = String(
    metadata.api ?? metadata.endpoint ?? (metadata.provider as Record<string, unknown> | undefined)?.api ?? ''
  )
  if (
    api.includes('chat/completions') ||
    ['openai-completions', 'chat-completions', 'openai-compatible'].includes(api)
  )
    return 'chat-completions'
  if (api.includes('responses') || api === 'openai') return 'responses'
  if (api.includes('messages') || api.includes('anthropic')) return 'messages'
  const entry = catalog.providers[preset]?.models as
    Record<string, { protocol: Model['protocol'] }> | undefined
  return entry?.[String(metadata.id)]?.protocol ?? 'unsupported'
}

export function mergeModels(provider: Provider, data: unknown): Model[] {
  const list = Array.isArray(data) ? data : (data as { data?: unknown })?.data
  if (!Array.isArray(list)) throw new AppError('invalid_model_list')
  const found: Model[] = []
  for (const row of list) {
    if (!row || typeof row !== 'object' || typeof row.id !== 'string') continue
    const old = provider.models.find((model) => model.id === row.id)
    const protocol =
      old?.source === 'manual' ? old.protocol : detectProtocol(provider.preset, row, provider.protocol)
    const parsed = modelSchema.safeParse({
      id: row.id,
      name: old?.name ?? row.name ?? row.id,
      protocol,
      enabled: old?.enabled ?? true,
      favorite: old?.favorite ?? false,
      source: old?.source === 'manual' ? 'manual' : 'discovered',
      jsonMode: old?.jsonMode ?? provider.preset === 'deepseek',
      streaming: old?.streaming,
      maxTokensField: old?.maxTokensField,
      contextWindow: Number(row.context_window ?? row.context_length) || old?.contextWindow,
      maxOutput: Number(row.max_output_tokens) || old?.maxOutput,
      missing: false
    })
    if (parsed.success) found.push(parsed.data)
  }
  if (!found.length) throw new AppError('invalid_model_list')
  for (const model of provider.models)
    if (!found.some((item) => item.id === model.id))
      found.push({ ...model, missing: model.source !== 'manual' })
  return found
}

function headers(provider: Provider, key?: string, protocol?: string): Record<string, string> {
  const result: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream'
  }
  if (key) result.Authorization = `Bearer ${key}`
  if (protocol === 'messages') {
    result['anthropic-version'] = '2023-06-01'
    if (key) result['x-api-key'] = key
  }
  return result
}

function httpError(response: Response): AppError {
  const retryAfter = response.headers.get('retry-after')
  const retryAfterMs = retryAfter
    ? Number.isFinite(Number(retryAfter))
      ? Number(retryAfter) * 1000
      : Math.max(0, Date.parse(retryAfter) - Date.now())
    : undefined
  if (response.status === 401 || response.status === 403) return new AppError('auth_error')
  if (response.status === 429) return new AppError('rate_limited', true, retryAfterMs)
  if (response.status === 404) return new AppError('model_not_found')
  if (response.status >= 500) return new AppError('service_error', true, retryAfterMs)
  return new AppError('request_rejected')
}

export async function discover(provider: Provider, key?: string, signal?: AbortSignal): Promise<Model[]> {
  if (provider.requiresKey && !key) throw new AppError('missing_key')
  try {
    const response = await fetch(endpoint(provider.baseUrl, 'models'), {
      headers: headers(provider, key),
      redirect: 'error',
      signal: AbortSignal.any([AbortSignal.timeout(15000), ...(signal ? [signal] : [])])
    })
    if (!response.ok) throw httpError(response)
    return mergeModels(provider, await response.json())
  } catch (error) {
    throw classifyError(error, signal)
  }
}

export function classifyError(error: unknown, signal?: AbortSignal): AppError {
  if (signal?.aborted) return new AppError('canceled')
  if (error instanceof AppError) return error
  if (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name))
    return new AppError('timeout', true)
  return new AppError('network_error', true)
}

export async function* sse(response: Response, signal: AbortSignal): AsyncGenerator<unknown> {
  if (!response.body) throw new AppError('empty_result')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      signal.throwIfAborted()
      let timer: ReturnType<typeof setTimeout> | undefined
      const part = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new AppError('timeout', true)), 30000)
        })
      ]).finally(() => clearTimeout(timer))
      buffer += decoder.decode(part.value, { stream: !part.done })
      buffer = buffer.replace(/\r\n/g, '\n')
      let index: number
      while ((index = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, index)
        buffer = buffer.slice(index + 2)
        const data = block
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n')
        if (data === '[DONE]') {
          yield { __done: true }
          continue
        }
        if (data) {
          try {
            yield JSON.parse(data)
          } catch {
            throw new AppError('invalid_stream')
          }
        }
      }
      if (part.done) {
        if (buffer.trim()) {
          const data = buffer
            .split('\n')
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trimStart())
            .join('\n')
          if (data === '[DONE]') yield { __done: true }
          else if (data) {
            try {
              yield JSON.parse(data)
            } catch {
              throw new AppError('invalid_stream')
            }
          }
        }
        break
      }
    }
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

export type Generation = { content: string; usage: Usage }
export type GenerateOptions = {
  provider: Provider
  model: Model
  key?: string
  system: string
  user: string
  signal: AbortSignal
  onDelta?: (text: string) => void
  retries?: number
}

function requestBody(
  model: Model,
  provider: Provider,
  system: string,
  user: string
): { path: string; body: Record<string, unknown> } {
  const max = Math.min(model.maxOutput ?? 8192, 16384)
  const stream = model.streaming !== false
  if (model.protocol === 'responses')
    return {
      path: 'responses',
      body: {
        model: model.id,
        instructions: system,
        input: user,
        stream,
        max_output_tokens: max,
        ...(model.jsonMode ? { text: { format: { type: 'json_object' } } } : {})
      }
    }
  if (model.protocol === 'messages')
    return {
      path: 'messages',
      body: { model: model.id, system, messages: [{ role: 'user', content: user }], max_tokens: max, stream }
    }
  if (model.protocol !== 'chat-completions') throw new AppError('unsupported_protocol')
  return {
    path: 'chat/completions',
    body: {
      model: model.id,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      stream,
      [model.maxTokensField ?? 'max_tokens']: max,
      ...(model.jsonMode ? { response_format: { type: 'json_object' } } : {}),
      ...(provider.preset === 'deepseek' ? { thinking: { type: 'disabled' } } : {})
    }
  }
}

function textFromResponse(data: any, protocol: string): string {
  if (protocol === 'chat-completions') return data.choices?.[0]?.message?.content ?? ''
  if (protocol === 'messages')
    return (data.content ?? [])
      .filter((part: any) => part.type === 'text')
      .map((part: any) => part.text)
      .join('')
  return (data.output ?? [])
    .filter((part: any) => part.type === 'message')
    .flatMap((part: any) => part.content ?? [])
    .filter((part: any) => part.type === 'output_text')
    .map((part: any) => part.text)
    .join('')
}

export async function generate(options: GenerateOptions): Promise<Generation> {
  const { provider, model, key, system, user, signal, onDelta } = options
  if (!provider.enabled || !model.enabled) throw new AppError('model_disabled')
  if (provider.requiresKey && !key) throw new AppError('missing_key')
  const request = requestBody(model, provider, system, user)
  let emitted = false
  const retries = Math.min(Math.max(options.retries ?? 2, 0), 2)
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const combined = AbortSignal.any([signal, AbortSignal.timeout(provider.timeoutMs)])
      const response = await fetch(endpoint(provider.baseUrl, request.path), {
        method: 'POST',
        redirect: 'error',
        headers: headers(provider, key, model.protocol),
        body: JSON.stringify(request.body),
        signal: combined
      })
      if (!response.ok) throw httpError(response)
      let content = ''
      let complete = false
      const usage: Usage = { input: null, output: null }
      const readUsage = (data: any) => {
        const u = data?.usage ?? data?.response?.usage ?? data?.message?.usage
        if (u) {
          usage.input = u.prompt_tokens ?? u.input_tokens ?? usage.input
          usage.output = u.completion_tokens ?? u.output_tokens ?? usage.output
        }
      }
      if (!(response.headers.get('content-type') ?? '').includes('text/event-stream')) {
        const data = (await response.json()) as any
        if (data.error) throw new AppError('service_error')
        if (
          data.choices?.[0]?.finish_reason === 'length' ||
          data.stop_reason === 'max_tokens' ||
          data.status === 'incomplete'
        )
          throw new AppError('truncated_result')
        content = textFromResponse(data, model.protocol)
        readUsage(data)
        complete = true
        onDelta?.(content)
      } else {
        for await (const raw of sse(response, combined)) {
          const data = raw as any
          readUsage(data)
          if (data.error || data.type === 'error' || data.type === 'response.failed')
            throw new AppError('service_error')
          let delta = ''
          if (model.protocol === 'chat-completions') {
            if (data.choices?.[0]?.finish_reason === 'length') throw new AppError('truncated_result')
            delta = data.choices?.[0]?.delta?.content ?? ''
            if (data.__done || data.choices?.[0]?.finish_reason === 'stop') complete = true
          } else if (model.protocol === 'responses') {
            if (data.type === 'response.output_text.delta') delta = data.delta ?? ''
            if (data.type === 'response.completed') {
              complete = true
              if (!content) content = textFromResponse(data.response, model.protocol)
            }
            if (data.type === 'response.incomplete') throw new AppError('truncated_result')
          } else {
            if (data.type === 'content_block_delta' && data.delta?.type === 'text_delta')
              delta = data.delta.text ?? ''
            if (data.delta?.stop_reason === 'max_tokens') throw new AppError('truncated_result')
            if (data.type === 'message_stop') complete = true
          }
          if (typeof delta === 'string' && delta) {
            content += delta
            emitted = true
            onDelta?.(content)
          }
          if (content.length > 500000) throw new AppError('result_too_large')
        }
      }
      if (!complete) throw new AppError('incomplete_stream')
      if (!content.trim()) throw new AppError('empty_result')
      return { content, usage }
    } catch (error) {
      const classified = classifyError(error, signal)
      if (!classified.retryable || emitted || attempt === retries || signal.aborted) throw classified
      const delay = Math.min(classified.retryAfterMs ?? 1000 * 2 ** attempt, 10000)
      await new Promise<void>((resolve, reject) => {
        const abort = () => {
          clearTimeout(timer)
          reject(new AppError('canceled'))
        }
        const timer = setTimeout(() => {
          signal.removeEventListener('abort', abort)
          resolve()
        }, delay)
        signal.addEventListener('abort', abort, { once: true })
        if (signal.aborted) abort()
      })
    }
  }
  throw new AppError('service_error')
}
