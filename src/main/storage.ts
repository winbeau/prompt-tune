import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { isPresentationOnlyChange, substantiveChanges } from '../shared/changes'
import {
  AppError,
  defaultSettings,
  presets,
  providerSchema,
  settingsSchema,
  type HistoryItem,
  type Insight,
  type Job,
  type Provider,
  type Settings
} from '../shared/types'

type Codec = {
  isEncryptionAvailable(): boolean
  encryptString(text: string): Buffer
  decryptString(data: Buffer): string
}

export class CredentialVault {
  private values: Record<string, string> | undefined
  private session = new Map<string, string>()
  constructor(
    private directory: string,
    private codec: Codec
  ) {}
  get persistent(): boolean {
    return this.codec.isEncryptionAvailable()
  }
  private load(): Record<string, string> {
    if (this.values) return this.values
    const file = join(this.directory, 'credentials.enc')
    if (!existsSync(file)) return (this.values = {})
    if (!this.persistent) throw new AppError('credentials_unavailable')
    try {
      return (this.values = JSON.parse(this.codec.decryptString(readFileSync(file))))
    } catch {
      throw new AppError('credentials_unavailable')
    }
  }
  get(id: string): string | undefined {
    return this.session.get(id) ?? this.load()[id]
  }
  has(id: string): boolean {
    try {
      return !!this.get(id)
    } catch {
      return false
    }
  }
  set(id: string, key: string): void {
    if (!this.persistent) {
      this.session.set(id, key)
      return
    }
    const values = { ...this.load(), [id]: key }
    this.write(values)
    this.values = values
    this.session.delete(id)
  }
  remove(id: string): void {
    const values = { ...this.load() }
    delete values[id]
    if (this.persistent) this.write(values)
    this.values = values
    this.session.delete(id)
  }
  private write(values: Record<string, string>): void {
    const temp = join(this.directory, 'credentials.enc.tmp')
    writeFileSync(temp, this.codec.encryptString(JSON.stringify(values)), { mode: 0o600 })
    chmodSync(temp, 0o600)
    renameSync(temp, join(this.directory, 'credentials.enc'))
  }
}

export type SummaryEvidence = { historyId: string; from: string; to: string }
export type SummaryInsight = {
  pattern: string
  title: string
  category: string
  explanation: string
  from: string
  to: string
  evidence: SummaryEvidence[]
}

export class Store {
  readonly db: DatabaseSync
  constructor(path: string) {
    this.db = new DatabaseSync(path)
    this.db.exec(`PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS providers (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS history (id TEXT PRIMARY KEY, input TEXT NOT NULL, output TEXT NOT NULL, created_at TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS summary_jobs (id TEXT PRIMARY KEY, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, error TEXT, created_at TEXT NOT NULL, next_run_at INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS job_items (job_id TEXT REFERENCES summary_jobs(id) ON DELETE CASCADE, history_id TEXT UNIQUE REFERENCES history(id) ON DELETE CASCADE, PRIMARY KEY(job_id,history_id));
      CREATE TABLE IF NOT EXISTS insights (id TEXT PRIMARY KEY, pattern TEXT NOT NULL UNIQUE, data TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active');
      CREATE TABLE IF NOT EXISTS evidence (insight_id TEXT REFERENCES insights(id) ON DELETE CASCADE, history_id TEXT REFERENCES history(id) ON DELETE CASCADE, source TEXT NOT NULL, target TEXT NOT NULL, PRIMARY KEY(insight_id,history_id,source));
      CREATE TABLE IF NOT EXISTS attempts (id TEXT PRIMARY KEY, task TEXT NOT NULL, created_at TEXT NOT NULL, provider_id TEXT NOT NULL, model_id TEXT NOT NULL, status TEXT NOT NULL, data TEXT NOT NULL);
      `)
    if (Number(this.db.prepare('PRAGMA user_version').get()!.user_version) < 2) {
      this.transaction(() => {
        for (const row of this.db.prepare('SELECT id,data FROM history').all()) {
          const item = JSON.parse(row.data as string) as HistoryItem
          const changes = substantiveChanges(item.result.changes)
          if (changes.length === item.result.changes.length) continue
          for (const change of item.result.changes)
            if (isPresentationOnlyChange(change.from, change.to))
              this.db
                .prepare('DELETE FROM evidence WHERE history_id=? AND source=? AND target=?')
                .run(row.id, change.from, change.to)
          item.result.changes = changes
          this.db.prepare('UPDATE history SET data=? WHERE id=?').run(JSON.stringify(item), row.id)
        }
        this.recountInsights()
        this.db.exec('PRAGMA user_version = 2')
      })
    }
    if (!this.db.prepare('SELECT id FROM settings WHERE id=1').get())
      this.saveSettings(structuredClone(defaultSettings))
    for (const provider of presets)
      if (!this.provider(provider.id)) this.saveProvider(structuredClone(provider))
    this.db.prepare("UPDATE summary_jobs SET status='pending' WHERE status='running'").run()
  }
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const result = fn()
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }
  settings(): Settings {
    return settingsSchema.parse(
      JSON.parse(this.db.prepare('SELECT data FROM settings WHERE id=1').get()!.data as string)
    )
  }
  saveSettings(settings: Settings): void {
    this.db
      .prepare('INSERT OR REPLACE INTO settings(id,data) VALUES(1,?)')
      .run(JSON.stringify(settingsSchema.parse(settings)))
  }
  providers(): Provider[] {
    return this.db
      .prepare('SELECT data FROM providers ORDER BY rowid')
      .all()
      .map((row) => providerSchema.parse(JSON.parse(row.data as string)))
  }
  provider(id: string): Provider | undefined {
    const row = this.db.prepare('SELECT data FROM providers WHERE id=?').get(id)
    return row ? providerSchema.parse(JSON.parse(row.data as string)) : undefined
  }
  saveProvider(provider: Provider): void {
    this.db
      .prepare('INSERT INTO providers(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data')
      .run(provider.id, JSON.stringify(providerSchema.parse(provider)))
  }
  removeProvider(id: string): void {
    this.db.prepare('DELETE FROM providers WHERE id=?').run(id)
  }
  history(query = ''): HistoryItem[] {
    return this.db
      .prepare(
        'SELECT data FROM history WHERE input LIKE ? OR output LIKE ? ORDER BY created_at DESC LIMIT 200'
      )
      .all(`%${query}%`, `%${query}%`)
      .map((row) => JSON.parse(row.data as string))
  }
  historyItem(id: string): HistoryItem | undefined {
    const row = this.db.prepare('SELECT data FROM history WHERE id=?').get(id)
    return row ? JSON.parse(row.data as string) : undefined
  }
  historyCount(): number {
    return Number(this.db.prepare('SELECT count(*) AS n FROM history').get()!.n)
  }
  pendingCount(): number {
    return Number(
      this.db
        .prepare('SELECT count(*) AS n FROM history WHERE id NOT IN (SELECT history_id FROM job_items)')
        .get()!.n
    )
  }
  saveHistory(item: HistoryItem): void {
    item = { ...item, result: { ...item.result, changes: substantiveChanges(item.result.changes) } }
    this.transaction(() => {
      if (this.historyItem(item.id)) {
        this.invalidateJobs(item.id)
        this.db.prepare('DELETE FROM evidence WHERE history_id=?').run(item.id)
      }
      this.db
        .prepare('INSERT OR REPLACE INTO history(id,input,output,created_at,data) VALUES(?,?,?,?,?)')
        .run(item.id, item.input, item.result.outputText ?? '', item.createdAt, JSON.stringify(item))
      this.recountInsights()
      this.enqueue(false)
    })
  }
  private invalidateJobs(historyId: string): void {
    const rows = this.db.prepare('SELECT job_id FROM job_items WHERE history_id=?').all(historyId)
    for (const row of rows) {
      this.db.prepare("UPDATE summary_jobs SET status='canceled' WHERE id=?").run(row.job_id)
      this.db.prepare('DELETE FROM job_items WHERE job_id=?').run(row.job_id)
    }
  }
  deleteHistory(id: string): void {
    this.transaction(() => {
      this.invalidateJobs(id)
      this.db.prepare('DELETE FROM history WHERE id=?').run(id)
      this.recountInsights()
      this.enqueue(false)
    })
  }
  clearHistory(): void {
    this.transaction(() => {
      this.db.exec(
        'DELETE FROM summary_jobs; DELETE FROM history; DELETE FROM insights; DELETE FROM attempts;'
      )
    })
  }
  rejectChange(id: string, from: string): void {
    this.transaction(() => {
      const item = this.historyItem(id)
      if (!item) return
      item.result.changes = item.result.changes.filter((change) => change.from !== from)
      this.db.prepare('UPDATE history SET data=? WHERE id=?').run(JSON.stringify(item), id)
      this.invalidateJobs(id)
      this.db.prepare('DELETE FROM evidence WHERE history_id=? AND source=?').run(id, from)
      this.recountInsights()
      this.enqueue(false)
    })
  }
  enqueue(force: boolean): string[] {
    const settings = this.settings()
    if (!force && (!settings.autoSummary || !settings.saveHistory)) return []
    const rows = this.db
      .prepare(
        'SELECT id FROM history WHERE id NOT IN (SELECT history_id FROM job_items) ORDER BY created_at, rowid'
      )
      .all()
    const ids: string[] = []
    for (let i = 0; i < rows.length; i += settings.summaryEvery) {
      const chunk = rows.slice(i, i + settings.summaryEvery)
      if (chunk.length < settings.summaryEvery && !force) break
      const id = randomUUID()
      ids.push(id)
      this.db
        .prepare("INSERT INTO summary_jobs(id,status,created_at) VALUES(?,'pending',?)")
        .run(id, new Date().toISOString())
      for (const row of chunk)
        this.db.prepare('INSERT INTO job_items(job_id,history_id) VALUES(?,?)').run(id, row.id)
    }
    return ids
  }
  jobs(): Job[] {
    return this.db
      .prepare(
        "SELECT id,status,attempts,error,created_at AS createdAt,next_run_at AS nextRunAt FROM summary_jobs WHERE status NOT IN ('completed','canceled') ORDER BY created_at LIMIT 30"
      )
      .all() as unknown as Job[]
  }
  nextJob(): Job | undefined {
    return this.jobs().find(
      (job) => ['pending', 'retry_wait'].includes(job.status) && job.nextRunAt <= Date.now()
    )
  }
  jobStatus(id: string): string | undefined {
    return this.db.prepare('SELECT status FROM summary_jobs WHERE id=?').get(id)?.status as string | undefined
  }
  jobItems(id: string): HistoryItem[] {
    return this.db
      .prepare(
        'SELECT h.data FROM history h JOIN job_items j ON j.history_id=h.id WHERE j.job_id=? ORDER BY h.created_at,h.rowid'
      )
      .all(id)
      .map((row) => JSON.parse(row.data as string))
  }
  setJob(id: string, status: string, error: string | null = null, next = 0): void {
    this.db
      .prepare(
        "UPDATE summary_jobs SET status=?,error=?,next_run_at=?,attempts=attempts+? WHERE id=? AND status NOT IN ('canceled','completed')"
      )
      .run(status, error, next, status === 'running' ? 1 : 0, id)
  }
  retryJob(id: string): void {
    this.db
      .prepare(
        "UPDATE summary_jobs SET status='pending',error=NULL,next_run_at=0,attempts=0 WHERE id=? AND status='failed'"
      )
      .run(id)
  }
  summaryCallsToday(): number {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    return Number(
      this.db
        .prepare("SELECT count(*) AS n FROM attempts WHERE task='summarize' AND created_at>=?")
        .get(start.toISOString())!.n
    )
  }
  recordAttempt(
    id: string,
    task: string,
    providerId: string,
    modelId: string,
    status: string,
    data: unknown
  ): void {
    this.db
      .prepare(
        'INSERT OR REPLACE INTO attempts(id,task,provider_id,model_id,status,created_at,data) VALUES(?,?,?,?,?,?,?)'
      )
      .run(id, task, providerId, modelId, status, new Date().toISOString(), JSON.stringify(data))
  }
  completeJob(id: string, proposals: SummaryInsight[], locale: 'en' | 'zh-CN'): boolean {
    return this.transaction(() => {
      if (this.jobStatus(id) !== 'running') return false
      const items = new Map(this.jobItems(id).map((item) => [item.id, item]))
      for (const proposal of proposals) {
        const valid = proposal.evidence.filter((evidence) => {
          const item = items.get(evidence.historyId)
          return (
            item?.mode === 'tune' &&
            item.input.includes(evidence.from) &&
            item.result.changes.some(
              (change) =>
                change.kind === 'correction' &&
                change.confidence >= 0.7 &&
                change.from === evidence.from &&
                change.to === evidence.to
            )
          )
        })
        if (!valid.length) continue
        const pattern = proposal.pattern.toLowerCase().trim().replace(/\s+/g, '-')
        const existing = this.db.prepare('SELECT id FROM insights WHERE pattern=?').get(pattern)
        const insightId = (existing?.id as string | undefined) ?? randomUUID()
        const data = {
          ...proposal,
          from: valid[0].from,
          to: valid[0].to,
          id: insightId,
          pattern,
          locale,
          updatedAt: new Date().toISOString()
        }
        this.db
          .prepare(
            "INSERT INTO insights(id,pattern,data,status) VALUES(?,?,?,'active') ON CONFLICT(pattern) DO UPDATE SET data=excluded.data"
          )
          .run(insightId, pattern, JSON.stringify(data))
        for (const evidence of valid)
          this.db
            .prepare('INSERT OR IGNORE INTO evidence(insight_id,history_id,source,target) VALUES(?,?,?,?)')
            .run(insightId, evidence.historyId, evidence.from, evidence.to)
      }
      this.setJob(id, 'completed')
      this.recountInsights()
      return true
    })
  }
  private recountInsights(): void {
    this.db
      .prepare("DELETE FROM insights WHERE status='active' AND id NOT IN (SELECT insight_id FROM evidence)")
      .run()
  }
  insights(): Insight[] {
    return this.db
      .prepare('SELECT id,data,status FROM insights ORDER BY rowid DESC')
      .all()
      .map((row) => {
        const ids = this.db
          .prepare('SELECT DISTINCT history_id FROM evidence WHERE insight_id=?')
          .all(row.id)
          .map((item) => item.history_id as string)
        return { ...JSON.parse(row.data as string), status: row.status, count: ids.length, historyIds: ids }
      })
  }
  insightStatus(id: string, status: Insight['status']): void {
    this.db.prepare('UPDATE insights SET status=? WHERE id=?').run(status, id)
  }
  close(): void {
    this.db.close()
  }
}
