import { describe, expect, it } from 'vitest'
import { parseResult, partialOutput, systemPrompt } from '../src/main/prompts'
import { en, zh } from '../src/renderer/src/i18n'

const response = (outputText: string, changes: unknown[] = []) =>
  JSON.stringify({ status: 'completed', outputText, changes, ambiguities: [] })
describe('faithful prompt editing', () => {
  it('preserves correct short imperative prompts', () => {
    expect(parseResult(response('Fix the bug.'), 'Fix the bug.', 'tune').outputText).toBe('Fix the bug.')
    expect(systemPrompt('tune', 'en')).toContain('Imperative fragments are valid')
  })
  it('rejects changed code and placeholders instead of saving them', () => {
    for (const input of ['Fix `user_id`.', 'Keep {{name}}.', 'Use ${HOME}.', '```js\nconst a = 1\n```'])
      expect(() => parseResult(response('Rewrite everything.'), input, 'tune')).toThrow('protected_text')
  })
  it('drops changes with fabricated evidence and separates translation from errors', () => {
    const change = {
      from: '修复',
      to: 'Fix',
      category: 'grammar',
      kind: 'correction',
      reason: 'Reason',
      confidence: 0.9
    }
    const parsed = parseResult(
      response('Fix the bug.', [change, { ...change, from: 'invented' }]),
      '修复 bug。',
      'translate'
    )
    expect(parsed.changes).toHaveLength(1)
    expect(parsed.changes[0].kind).toBe('translation_choice')
  })
  it('requires meaningful complete results or an explained clarification', () => {
    expect(() => parseResult(response(''), 'hi', 'tune')).toThrow('invalid_result')
    expect(() =>
      parseResult(
        '{"status":"needs_clarification","outputText":null,"changes":[],"ambiguities":[]}',
        'hi',
        'tune'
      )
    ).toThrow('invalid_result')
  })
  it('decodes streaming output without displaying JSON scaffolding', () => {
    expect(partialOutput('{"outputText":"Hello\\nworld')).toBe('Hello\nworld')
    expect(partialOutput('{"outputText":"Hello\\')).toBe('Hello')
  })
  it('covers every interface key in English and Chinese', () => {
    function keys(value: Record<string, unknown>, prefix = ''): string[] {
      return Object.entries(value).flatMap(([key, item]) =>
        typeof item === 'object' ? keys(item as Record<string, unknown>, prefix + key + '.') : [prefix + key]
      )
    }
    expect(keys(en).sort()).toEqual(keys(zh).sort())
  })
})
