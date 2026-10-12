import { afterEach, describe, expect, it, vi } from 'vitest'
import { discover, endpoint, generate, mergeModels, sse } from '../src/main/models'
import { presets } from '../src/shared/types'

afterEach(() => vi.restoreAllMocks())
const provider = structuredClone(presets[0])
const model = provider.models[0]
const signal = () => new AbortController().signal
describe('provider registry', () => {
  it('keeps API subpaths without adding v1 twice', () =>
    expect(endpoint('https://x.test/gateway/v1/', '/chat/completions')).toBe(
      'https://x.test/gateway/v1/chat/completions'
    ))
  it('uses verified OpenCode mappings and leaves unknown IDs unavailable', () => {
    const zen = mergeModels(presets[1], {
      data: [{ id: 'deepseek-v4-flash' }, { id: 'gpt-5.5' }, { id: 'brand-new-model' }]
    })
    expect(zen.map((value) => value.protocol)).toEqual(['chat-completions', 'responses', 'unsupported'])
  })
  it('preserves explicit model overrides when discovery has sparse metadata', () => {
    const original = {
      ...provider,
      models: [
        {
          ...model,
          protocol: 'responses' as const,
          source: 'manual' as const,
          name: 'My model',
          streaming: false
        }
      ]
    }
    expect(mergeModels(original, { data: [{ id: model.id }] })[0]).toMatchObject({
      protocol: 'responses',
      name: 'My model',
      streaming: false
    })
  })
  it('reports authentication failure without exposing service text', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('secret details', { status: 401 }))
    await expect(discover(provider, 'key')).rejects.toThrow('auth_error')
  })
  it('retains missing models and their bindings for review', () => {
    const updated = mergeModels(provider, { data: [{ id: 'a-new-model' }] })
    expect(updated.find((value) => value.id === model.id)).toMatchObject({ missing: true, enabled: true })
    expect(
      mergeModels({ ...provider, models: updated }, { data: [{ id: model.id }] }).find(
        (value) => value.id === model.id
      )?.missing
    ).toBe(false)
  })
})
describe('protocol adapters', () => {
  it.each(['responses', 'messages'] as const)(
    'handles %s stream events and final usage',
    async (protocol) => {
      const events =
        protocol === 'responses'
          ? [
              { type: 'response.output_text.delta', delta: 'hello' },
              { type: 'response.completed', response: { usage: { input_tokens: 5, output_tokens: 2 } } }
            ]
          : [
              { type: 'message_start', message: { usage: { input_tokens: 5 } } },
              { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hello' } },
              { type: 'message_delta', usage: { output_tokens: 2 }, delta: { stop_reason: 'end_turn' } },
              { type: 'message_stop' }
            ]
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), {
          headers: { 'content-type': 'text/event-stream' }
        })
      )
      await expect(
        generate({
          provider,
          model: { ...model, protocol },
          key: 'key',
          system: 's',
          user: 'u',
          signal: signal()
        })
      ).resolves.toEqual({ content: 'hello', usage: { input: 5, output: 2 } })
    }
  )
  it('parses split UTF-8 and CRLF events', async () => {
    const encoded = new TextEncoder().encode('data: {"text":"中文"}\r\n\r\ndata: [DONE]\r\n\r\n')
    const stream = new ReadableStream({
      start(controller) {
        for (let i = 0; i < encoded.length; i++) controller.enqueue(encoded.slice(i, i + 1))
        controller.close()
      }
    })
    const result = []
    for await (const event of sse(new Response(stream), signal())) result.push(event)
    expect(result).toEqual([{ text: '中文' }, { __done: true }])
  })
  it.each(['chat-completions', 'responses', 'messages'] as const)(
    'normalizes %s text and token usage',
    async (protocol) => {
      const data =
        protocol === 'chat-completions'
          ? {
              choices: [{ message: { content: 'hello' }, finish_reason: 'stop' }],
              usage: { prompt_tokens: 5, completion_tokens: 2 }
            }
          : protocol === 'responses'
            ? {
                status: 'completed',
                output: [{ type: 'message', content: [{ type: 'output_text', text: 'hello' }] }],
                usage: { input_tokens: 5, output_tokens: 2 }
              }
            : {
                content: [{ type: 'text', text: 'hello' }],
                stop_reason: 'end_turn',
                usage: { input_tokens: 5, output_tokens: 2 }
              }
      const mock = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(
          new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } })
        )
      const output = await generate({
        provider,
        model: { ...model, protocol },
        key: 'key',
        system: 'system',
        user: 'user',
        signal: signal()
      })
      expect(output).toEqual({ content: 'hello', usage: { input: 5, output: 2 } })
      const request = JSON.parse(mock.mock.calls[0][1]?.body as string)
      if (protocol === 'chat-completions') expect(request.thinking).toEqual({ type: 'disabled' })
      else expect(request.thinking).toBeUndefined()
    }
  )
  it('rejects truncated content', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: 'partial' }, finish_reason: 'length' }] }),
        { headers: { 'content-type': 'application/json' } }
      )
    )
    await expect(
      generate({ provider, model, key: 'key', system: 's', user: 'u', signal: signal() })
    ).rejects.toThrow('truncated_result')
  })
  it('rejects streams that ended without completion', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n', {
        headers: { 'content-type': 'text/event-stream' }
      })
    )
    await expect(
      generate({ provider, model, key: 'key', system: 's', user: 'u', signal: signal() })
    ).rejects.toThrow('incomplete_stream')
  })
  it('cancels before any service request retries', async () => {
    const controller = new AbortController()
    controller.abort()
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new DOMException('Aborted', 'AbortError'))
    await expect(
      generate({ provider, model, key: 'key', system: 's', user: 'u', signal: controller.signal })
    ).rejects.toThrow('canceled')
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
