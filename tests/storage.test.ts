import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { CredentialVault, Store } from '../src/main/storage'
import type { HistoryItem } from '../src/shared/types'

const stores: Store[] = []
const directories: string[] = []
afterEach(() => {
  for (const store of stores.splice(0)) store.close()
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true })
})
const store = () => {
  const db = new Store(':memory:')
  stores.push(db)
  return db
}
function item(id = randomUUID(), mode: 'tune' | 'translate' = 'tune'): HistoryItem {
  return {
    id,
    mode,
    input: 'Please explain me this.',
    result: {
      status: 'completed',
      outputText: 'Please explain this to me.',
      changes: [
        {
          from: 'explain me',
          to: 'explain this to me',
          category: 'grammar',
          kind: mode === 'tune' ? 'correction' : 'translation_choice',
          reason: 'explain to',
          confidence: 0.95
        }
      ],
      ambiguities: []
    },
    binding: { providerId: 'deepseek', modelId: 'deepseek-flash' },
    locale: 'en',
    usage: { input: 3, output: 4 },
    elapsedMs: 1,
    createdAt: new Date().toISOString()
  }
}
describe('history and durable summary scheduling', () => {
  it('upgrades saved preferences with the larger text default without changing existing choices', () => {
    const db = store()
    const { fontSize: _fontSize, ...legacy } = { ...db.settings(), language: 'zh-CN', theme: 'black' }
    db.db.prepare('UPDATE settings SET data=? WHERE id=1').run(JSON.stringify(legacy))
    expect(db.settings()).toMatchObject({ fontSize: 16, language: 'zh-CN', theme: 'black' })
    db.saveSettings({ ...db.settings(), fontSize: 22 })
    expect(db.settings().fontSize).toBe(22)
  })
  it('queues at rounds 10 and 20 and does not count retries as a new round', () => {
    const db = store()
    const first = item()
    db.saveHistory(first)
    db.saveHistory(first)
    for (let i = 0; i < 8; i++) db.saveHistory(item())
    expect(db.historyCount()).toBe(9)
    expect(db.jobs()).toHaveLength(0)
    db.saveHistory(item())
    expect(db.jobs()).toHaveLength(1)
    expect(db.pendingCount()).toBe(0)
    for (let i = 0; i < 10; i++) db.saveHistory(item())
    expect(db.jobs()).toHaveLength(2)
    expect(db.historyCount()).toBe(20)
  })
  it('verifies real Tune corrections, deduplicates rounds and ignores translated evidence', () => {
    const db = store()
    const a = item()
    const b = item()
    const c = item(undefined, 'translate')
    for (const value of [a, b, c]) db.saveHistory(value)
    const [id] = db.transaction(() => db.enqueue(true))
    db.setJob(id, 'running')
    const evidence = [a, a, b, c].map((value) => ({
      historyId: value.id,
      from: 'explain me',
      to: 'explain this to me'
    }))
    db.completeJob(
      id,
      [
        {
          pattern: 'explain-to-person',
          title: 'Explain to',
          category: 'grammar',
          explanation: 'Use explain to.',
          from: 'a fabricated example',
          to: 'a fabricated replacement',
          evidence
        }
      ],
      'en'
    )
    expect(db.insights()[0].count).toBe(2)
    expect(db.insights()[0].from).toBe('explain me')
    expect(db.completeJob(id, [], 'en')).toBe(false)
    db.insightStatus(db.insights()[0].id, 'ignored')
    db.rejectChange(a.id, 'explain me')
    expect(db.insights()[0].count).toBe(1)
    expect(db.insights()[0].status).toBe('ignored')
    db.deleteHistory(b.id)
    expect(db.insights()[0].count).toBe(0)
  })
  it('invalidates an in-flight batch when its evidence is deleted', () => {
    const db = store()
    const a = item()
    db.saveHistory(a)
    const [id] = db.transaction(() => db.enqueue(true))
    db.setJob(id, 'running')
    db.deleteHistory(a.id)
    expect(db.jobStatus(id)).toBe('canceled')
    expect(db.completeJob(id, [], 'en')).toBe(false)
  })
  it('recovers an interrupted worker after reopening the database', () => {
    const path = mkdtempSync(join(tmpdir(), 'prompt-tune-db-'))
    directories.push(path)
    let db = new Store(join(path, 'state.sqlite'))
    db.saveHistory(item())
    const [id] = db.transaction(() => db.enqueue(true))
    db.setJob(id, 'running')
    db.close()
    db = new Store(join(path, 'state.sqlite'))
    stores.push(db)
    expect(db.jobStatus(id)).toBe('pending')
    expect(db.pendingCount()).toBe(0)
    db.clearHistory()
    expect(db.jobs()).toHaveLength(0)
    expect(db.historyCount()).toBe(0)
  })
  it('does not schedule automatically when history or summaries are disabled', () => {
    const db = store()
    db.saveSettings({ ...db.settings(), autoSummary: false })
    for (let i = 0; i < 11; i++) db.saveHistory(item())
    expect(db.jobs()).toHaveLength(0)
    expect(db.pendingCount()).toBe(11)
  })
})
describe('credential vault', () => {
  it('persists encrypted keys and returns no plaintext file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'prompt-tune-key-'))
    directories.push(dir)
    const key = randomBytes(32)
    const codec = {
      isEncryptionAvailable: () => true,
      encryptString(value: string) {
        const iv = randomBytes(12)
        const cipher = createCipheriv('aes-256-gcm', key, iv)
        return Buffer.concat([iv, cipher.update(value), cipher.final(), cipher.getAuthTag()])
      },
      decryptString(value: Buffer) {
        const decipher = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12))
        decipher.setAuthTag(value.subarray(-16))
        return Buffer.concat([decipher.update(value.subarray(12, -16)), decipher.final()]).toString()
      }
    }
    const vault = new CredentialVault(dir, codec)
    vault.set('deepseek', 'sk-private-test-key')
    expect(readFileSync(join(dir, 'credentials.enc')).includes('sk-private-test-key')).toBe(false)
    expect(new CredentialVault(dir, codec).get('deepseek')).toBe('sk-private-test-key')
    vault.remove('deepseek')
    expect(vault.has('deepseek')).toBe(false)
  })
})
