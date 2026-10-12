import type { PromptResult } from './types'

// Keep punctuation that can change meaning (apostrophes, hyphens, question marks).
// Sentence casing, whitespace cleanup and a terminal full stop need no edit card.
export function isPresentationOnlyChange(from: string, to: string): boolean {
  const normalize = (text: string) => text.trim().replace(/\s+/g, ' ').toLowerCase().replace(/\.$/, '')
  return normalize(from) === normalize(to)
}

export function substantiveChanges(changes: PromptResult['changes']): PromptResult['changes'] {
  return changes.filter((change) => !isPresentationOnlyChange(change.from, change.to))
}
