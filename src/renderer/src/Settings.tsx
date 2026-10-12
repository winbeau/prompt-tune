import { useEffect, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Check,
  ChevronDown,
  Copy,
  Download,
  Eye,
  EyeOff,
  FileText,
  Lightbulb,
  LoaderCircle,
  Minus,
  Plus,
  RefreshCw,
  Search,
  Star,
  Trash2,
  Upload,
  X
} from 'lucide-react'
import { fontSizes } from '../../shared/types'
import type {
  Binding,
  HistoryItem,
  Insight,
  Model,
  Provider,
  PublicProvider,
  Settings,
  Task
} from '../../shared/types'
import { useApp, SectionTitle, Toggle } from './App'

export function General() {
  const { t } = useTranslation()
  const { state, perform } = useApp()
  const [recording, setRecording] = useState(false)
  const settings = state.settings
  const update = (patch: Partial<Settings>) =>
    void perform(window.desktop.saveSettings({ ...settings, ...patch }))
  const modifier = window.platform === 'darwin' ? '⌘' : 'Ctrl'
  return (
    <div className="general-page">
      <SectionTitle title={t('preferences')} />
      <section className="settings-section">
        <h2>{t('language')}</h2>
        <div className="form-grid">
          <label>
            {t('language')}
            <select
              value={settings.language}
              onChange={(event) => update({ language: event.target.value as Settings['language'] })}
            >
              <option value="system">{t('system')}</option>
              <option value="zh-CN">{t('chinese')}</option>
              <option value="en">{t('english')}</option>
            </select>
          </label>
          <label>
            {t('explanation')}
            <select
              value={settings.explanationLanguage}
              onChange={(event) =>
                update({ explanationLanguage: event.target.value as Settings['explanationLanguage'] })
              }
            >
              <option value="ui">{t('followUi')}</option>
              <option value="zh-CN">{t('chinese')}</option>
              <option value="en">{t('english')}</option>
            </select>
          </label>
        </div>
      </section>
      <section className="settings-section">
        <h2>{t('appearance')}</h2>
        <label className="theme-preference">
          {t('theme')}
          <select
            aria-label={t('theme')}
            value={settings.theme}
            onChange={(event) => update({ theme: event.target.value as Settings['theme'] })}
          >
            <option value="system">{t('system')}</option>
            <option value="light">{t('light')}</option>
            <option value="black">{t('black')}</option>
          </select>
        </label>
        <div className="font-preference">
          <div className="font-preference-heading">
            <label htmlFor="font-size">{t('fontSize')}</label>
            <output htmlFor="font-size">{settings.fontSize} px</output>
            <button className="text-button" onClick={() => void perform(window.desktop.changeFontSize(0))}>
              {t('defaultSize')}
            </button>
          </div>
          <div className="font-size-controls">
            <button
              className="icon-button"
              aria-label={t('smallerText')}
              title={t('smallerText')}
              disabled={settings.fontSize === fontSizes.min}
              onClick={() => void perform(window.desktop.changeFontSize(-1))}
            >
              <Minus size={14} />
            </button>
            <input
              id="font-size"
              type="range"
              min={fontSizes.min}
              max={fontSizes.max}
              step={1}
              value={settings.fontSize}
              aria-valuetext={`${settings.fontSize} px`}
              style={
                {
                  '--range-progress': `${((settings.fontSize - fontSizes.min) / (fontSizes.max - fontSizes.min)) * 100}%`
                } as CSSProperties
              }
              onChange={(event) => update({ fontSize: Number(event.target.value) })}
            />
            <button
              className="icon-button"
              aria-label={t('largerText')}
              title={t('largerText')}
              disabled={settings.fontSize === fontSizes.max}
              onClick={() => void perform(window.desktop.changeFontSize(1))}
            >
              <Plus size={14} />
            </button>
          </div>
        </div>
        <Toggle
          label={t('alwaysOnTop')}
          checked={settings.alwaysOnTop}
          onChange={(value) => update({ alwaysOnTop: value })}
        />
        <Toggle
          label={t('historySetting')}
          description={t('historyDescription')}
          checked={settings.saveHistory}
          onChange={(value) => update({ saveHistory: value })}
        />
        <Toggle
          label={t('summarySetting')}
          description={t('summaryDescription')}
          checked={settings.autoSummary}
          onChange={(value) => update({ autoSummary: value })}
        />
        <div className="form-grid compact-grid">
          <label>
            {t('every')}
            <div className="input-suffix">
              <input
                aria-label={t('every')}
                key={`every-${settings.summaryEvery}`}
                type="number"
                min="2"
                max="100"
                defaultValue={settings.summaryEvery}
                onBlur={(event) => {
                  const value = Number(event.target.value)
                  if (value >= 2 && value <= 100 && value !== settings.summaryEvery)
                    update({ summaryEvery: Math.round(value) })
                }}
              />
              <span>{t('rounds')}</span>
            </div>
          </label>
          <label>
            {t('dailyLimit')}
            <input
              aria-label={t('dailyLimit')}
              key={`daily-${settings.summaryDailyLimit}`}
              type="number"
              min="1"
              max="1000"
              defaultValue={settings.summaryDailyLimit}
              onBlur={(event) => {
                const value = Number(event.target.value)
                if (value >= 1 && value <= 1000 && value !== settings.summaryDailyLimit)
                  update({ summaryDailyLimit: Math.round(value) })
              }}
            />
          </label>
        </div>
      </section>
      <section className="settings-section">
        <h2>{t('shortcuts')}</h2>
        <div className="shortcut-row">
          <span>{t('shortcutShow')}</span>
          <button
            className={`shortcut-recorder ${recording ? 'recording' : ''}`}
            onClick={() => setRecording(true)}
            onBlur={() => setRecording(false)}
            onKeyDown={(event) => {
              if (!recording) return
              event.preventDefault()
              event.stopPropagation()
              if (event.key === 'Escape') {
                setRecording(false)
                return
              }
              if (!event.metaKey && !event.ctrlKey && !event.altKey) return
              if (['Meta', 'Control', 'Alt', 'Shift'].includes(event.key)) return
              const keys: string[] = []
              if (event.metaKey) keys.push('Command')
              if (event.ctrlKey) keys.push('Control')
              if (event.altKey) keys.push('Alt')
              if (event.shiftKey) keys.push('Shift')
              keys.push(
                event.code === 'Space'
                  ? 'Space'
                  : event.key.length === 1
                    ? event.key.toUpperCase()
                    : event.key
              )
              update({ shortcut: keys.join('+') })
              setRecording(false)
            }}
          >
            {recording
              ? t('shortcutRecording')
              : settings.shortcut
                  .replace('CommandOrControl', modifier)
                  .replace('Command', '⌘')
                  .replace('Control', 'Ctrl')
                  .replace('Shift', '⇧')
                  .replace('Alt', '⌥')
                  .replace(/\+/g, ' ')}
          </button>
        </div>
        {state.shortcutError && <p className="field-error">{t('shortcutConflict')}</p>}
        {[
          ['shortcutRun', '↵'],
          ['largerText', `${modifier} +`],
          ['smallerText', `${modifier} −`],
          ['defaultSize', `${modifier} 0`],
          ['shortcutSettings', `${modifier} ,`],
          ['shortcutClose', `${modifier} W`],
          ['shortcutQuit', `${modifier} Q`]
        ].map(([key, value]) => (
          <div className="shortcut-row" key={key}>
            <span>{t(key)}</span>
            <kbd>{value}</kbd>
          </div>
        ))}
      </section>
    </div>
  )
}

export function Models() {
  const { t } = useTranslation()
  const { state, perform, notice } = useApp()
  const [selected, setSelected] = useState('deepseek')
  const [adding, setAdding] = useState(false)
  const selectedProvider = state.providers.find((provider) => provider.id === selected)
  const [newPreset, setNewPreset] = useState<Provider['preset']>('custom')
  const [newName, setNewName] = useState('')
  const [newUrl, setNewUrl] = useState('')
  async function add() {
    const preset = state.providers.find((provider) => provider.preset === newPreset)
    const provider: Provider = {
      id: crypto.randomUUID(),
      preset: newPreset,
      name: newName.trim() || preset?.name || t('custom'),
      baseUrl: newUrl.trim() || preset?.baseUrl || '',
      protocol: 'chat-completions',
      enabled: true,
      requiresKey: true,
      timeoutMs: 120000,
      status: 'untested',
      models: preset?.models ?? []
    }
    const updated = await perform(window.desktop.saveProvider(provider))
    if (updated) {
      setSelected(provider.id)
      setAdding(false)
      setNewName('')
      setNewUrl('')
      notice(t('saved'))
    }
  }
  return (
    <div className="models-page">
      <SectionTitle
        title={t('providerIntro')}
        description={t('providerSub')}
        action={
          <button className="secondary-button" onClick={() => setAdding(!adding)}>
            <Plus size={14} />
            {t('addProvider')}
          </button>
        }
      />
      {adding && (
        <div className="add-provider form-grid">
          <label>
            {t('preset')}
            <select
              value={newPreset}
              onChange={(event) => setNewPreset(event.target.value as Provider['preset'])}
            >
              <option value="custom">{t('custom')}</option>
              <option value="deepseek">DeepSeek</option>
              <option value="opencode">OpenCode Zen</option>
              <option value="opencode-go">OpenCode Go</option>
            </select>
          </label>
          <label>
            {t('providerName')}
            <input value={newName} onChange={(event) => setNewName(event.target.value)} />
          </label>
          <label className="full-width">
            {t('baseUrl')}
            <input
              value={newUrl}
              onChange={(event) => setNewUrl(event.target.value)}
              placeholder="https://api.example.com/v1"
            />
          </label>
          <button className="primary-button" onClick={() => void add()}>
            {t('addProvider')}
            <Plus size={14} />
          </button>
        </div>
      )}
      <div className="providers-layout">
        <aside className="provider-list">
          {state.providers.map((provider) => (
            <button
              key={provider.id}
              className={selected === provider.id ? 'selected' : ''}
              onClick={() => setSelected(provider.id)}
            >
              <span className={`provider-avatar ${provider.preset}`}>{provider.name.slice(0, 1)}</span>
              <span>
                <strong>{provider.name}</strong>
                <small>{provider.hasKey ? t(provider.status) : t('keyEmpty')}</small>
              </span>
              <span
                className={`status-dot ${provider.status === 'ready' && provider.hasKey ? 'connected' : ''}`}
              />
            </button>
          ))}
        </aside>
        {selectedProvider && (
          <ProviderEditor
            key={selectedProvider.id}
            provider={selectedProvider}
            onDeleted={() =>
              setSelected(state.providers.find((provider) => provider.id !== selected)?.id ?? '')
            }
          />
        )}
      </div>
      <section className="settings-section task-models">
        <h2>{t('taskModels')}</h2>
        <p className="section-description">{t('taskHint')}</p>
        {(['translate', 'tune', 'summarize'] as Task[]).map((task) => (
          <label className="task-binding" key={task}>
            <span>{t(task)}</span>
            <select
              value={JSON.stringify(state.settings.bindings[task])}
              aria-label={`${t(task)} ${t('model')}`}
              onChange={(event) =>
                void perform(
                  window.desktop.saveSettings({
                    ...state.settings,
                    bindings: {
                      ...state.settings.bindings,
                      [task]: JSON.parse(event.target.value) as Binding
                    }
                  })
                )
              }
            >
              {state.providers.flatMap((provider) =>
                provider.models
                  .filter((model) => model.enabled && model.protocol !== 'unsupported')
                  .map((model) => (
                    <option
                      key={`${provider.id}/${model.id}`}
                      value={JSON.stringify({ providerId: provider.id, modelId: model.id })}
                    >
                      {provider.name} · {model.name}
                    </option>
                  ))
              )}
            </select>
          </label>
        ))}
      </section>
      <div className="settings-tools">
        <button className="text-button" onClick={() => void perform(window.desktop.importConfig())}>
          <Upload size={13} />
          {t('importConfig')}
        </button>
        <button className="text-button" onClick={() => void perform(window.desktop.exportData('config'))}>
          <Download size={13} />
          {t('exportConfig')}
        </button>
      </div>
    </div>
  )
}

function ProviderEditor({ provider, onDeleted }: { provider: PublicProvider; onDeleted(): void }) {
  const { t } = useTranslation()
  const { state, perform, notice } = useApp()
  const [draft, setDraft] = useState<Provider>(provider)
  const [key, setKey] = useState('')
  const [reveal, setReveal] = useState(false)
  const [busy, setBusy] = useState('')
  const [newModel, setNewModel] = useState('')
  const [search, setSearch] = useState('')
  useEffect(() => setDraft(provider), [provider.refreshedAt])
  const patch = (value: Partial<Provider>) => setDraft({ ...draft, ...value })
  const patchModel = (id: string, value: Partial<Model>) =>
    patch({ models: draft.models.map((model) => (model.id === id ? { ...model, ...value } : model)) })
  async function save() {
    setBusy('save')
    const updated = await perform(window.desktop.saveProvider(draft, key.trim() || undefined))
    if (updated) {
      setDraft(updated.providers.find((item) => item.id === provider.id)!)
      setKey('')
      notice(t('saved'))
    }
    setBusy('')
  }
  async function check(kind: 'refresh' | 'test') {
    setBusy(kind)
    const saved = await perform(window.desktop.saveProvider(draft, key.trim() || undefined))
    if (saved) {
      setKey('')
      const updated = await perform(
        kind === 'refresh'
          ? window.desktop.refreshModels(provider.id)
          : window.desktop.testProvider(provider.id)
      )
      if (updated) {
        setDraft(updated.providers.find((item) => item.id === provider.id)!)
        notice(t(kind === 'test' ? 'tested' : 'saved'))
      }
    }
    setBusy('')
  }
  function addModel() {
    if (!newModel.trim() || draft.models.some((model) => model.id === newModel.trim())) return
    patch({
      models: [
        ...draft.models,
        {
          id: newModel.trim(),
          name: newModel.trim(),
          protocol: draft.protocol,
          enabled: true,
          favorite: false,
          source: 'manual',
          jsonMode: draft.preset === 'deepseek'
        }
      ]
    })
    setNewModel('')
  }
  const visible = draft.models
    .filter((model) => `${model.id} ${model.name}`.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => Number(b.favorite) - Number(a.favorite))
  return (
    <div className="provider-editor">
      <div className="provider-heading">
        <h2>{draft.name}</h2>
        <span className={`connection-pill ${provider.status}`}>
          {t(provider.hasKey || !provider.requiresKey ? provider.status : 'keyEmpty')}
        </span>
      </div>
      <div className="form-grid">
        <label>
          {t('providerName')}
          <input
            value={draft.name}
            maxLength={100}
            onChange={(event) => patch({ name: event.target.value })}
          />
        </label>
        <label>
          {t('timeout')}
          <input
            type="number"
            min="5"
            max="300"
            value={draft.timeoutMs / 1000}
            onChange={(event) => patch({ timeoutMs: Number(event.target.value) * 1000 })}
          />
        </label>
        <label className="full-width">
          {t('baseUrl')}
          <input
            value={draft.baseUrl}
            onChange={(event) => patch({ baseUrl: event.target.value })}
            spellCheck={false}
          />
        </label>
        <label className="full-width">
          {t('apiKey')}
          <div className="key-input">
            <input
              aria-label={t('apiKey')}
              type={reveal ? 'text' : 'password'}
              value={key}
              autoComplete="off"
              spellCheck={false}
              placeholder={provider.hasKey ? t('keyHint') : 'sk-…'}
              onChange={(event) => setKey(event.target.value)}
            />
            <button
              className="icon-button"
              title={t(reveal ? 'conceal' : 'reveal')}
              aria-label={t(reveal ? 'conceal' : 'reveal')}
              onClick={() => setReveal(!reveal)}
            >
              {reveal ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
        </label>
      </div>
      <p className="field-help">{state.credentialPersistence ? t('keyPrivacy') : t('keySession')}</p>
      <div className="provider-controls">
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(event) => patch({ enabled: event.target.checked })}
          />
          {t('enabled')}
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={draft.requiresKey}
            onChange={(event) => patch({ requiresKey: event.target.checked })}
          />
          {t('requiresKey')}
        </label>
      </div>
      <div className="provider-actions">
        <button className="primary-button" disabled={!!busy} onClick={() => void save()}>
          {busy === 'save' ? <LoaderCircle className="spin" size={14} /> : <Check size={14} />}
          {t('save')}
        </button>
        <button className="secondary-button" disabled={!!busy} onClick={() => void check('test')}>
          {busy === 'test' && <LoaderCircle size={13} className="spin" />}
          {t('test')}
        </button>
      </div>
      <div className="model-heading">
        <h3>
          {t('availableModels')}
          <span>{draft.models.length}</span>
        </h3>
        <button className="text-button" disabled={!!busy} onClick={() => void check('refresh')}>
          <RefreshCw size={12} className={busy === 'refresh' ? 'spin' : ''} />
          {t('refresh')}
        </button>
      </div>
      <div className="search-field">
        <Search size={13} />
        <input
          aria-label={t('availableModels')}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t('modelId')}
        />
      </div>
      <div className="model-list">
        {visible.map((model) => (
          <details className="model-row" key={model.id}>
            <summary>
              <button
                className={`icon-button favorite-button ${model.favorite ? 'favorited' : ''}`}
                aria-label={`${t('favorite')} ${model.name}`}
                onClick={(event) => {
                  event.preventDefault()
                  patchModel(model.id, { favorite: !model.favorite })
                }}
              >
                <Star size={13} />
              </button>
              <span className="model-label">
                <strong>{model.name}</strong>
                <code>
                  {model.id}
                  {model.missing ? ` · ${t('modelMissing')}` : ''}
                </code>
              </span>
              <span className={`protocol-label ${model.protocol === 'unsupported' ? 'unsupported' : ''}`}>
                {model.protocol === 'unsupported' ? t('unsupported') : model.protocol}
              </span>
              <ChevronDown size={12} />
            </summary>
            <div className="model-details form-grid">
              <label>
                {t('modelName')}
                <input
                  value={model.name}
                  onChange={(event) => patchModel(model.id, { name: event.target.value })}
                />
              </label>
              <label>
                {t('protocol')}
                <select
                  value={model.protocol}
                  onChange={(event) =>
                    patchModel(model.id, {
                      protocol: event.target.value as Model['protocol'],
                      source: 'manual'
                    })
                  }
                >
                  <option value="unsupported">{t('unsupported')}</option>
                  <option value="chat-completions">Chat Completions</option>
                  <option value="responses">Responses</option>
                  <option value="messages">Messages</option>
                </select>
              </label>
              <label>
                {t('maxOutput')}
                <input
                  type="number"
                  min="256"
                  max="16384"
                  value={model.maxOutput ?? 8192}
                  onChange={(event) => patchModel(model.id, { maxOutput: Number(event.target.value) })}
                />
              </label>
              <div className="model-flags">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={model.enabled}
                    onChange={(event) => patchModel(model.id, { enabled: event.target.checked })}
                  />
                  {t('enabled')}
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={model.jsonMode}
                    onChange={(event) => patchModel(model.id, { jsonMode: event.target.checked })}
                  />
                  {t('jsonMode')}
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={model.streaming !== false}
                    onChange={(event) => patchModel(model.id, { streaming: event.target.checked })}
                  />
                  {t('streaming')}
                </label>
              </div>
            </div>
          </details>
        ))}
      </div>
      <p className="field-help">{t('modelProtocolHint')}</p>
      <div className="manual-model">
        <input
          aria-label={t('modelId')}
          value={newModel}
          onChange={(event) => setNewModel(event.target.value)}
          placeholder={t('modelId')}
          onKeyDown={(event) => {
            if (event.key === 'Enter') addModel()
          }}
        />
        <button className="secondary-button" onClick={addModel}>
          <Plus size={13} />
          {t('addModel')}
        </button>
      </div>
      <label className="protocol-default">
        {t('protocol')}
        <select
          value={draft.protocol}
          onChange={(event) => patch({ protocol: event.target.value as Provider['protocol'] })}
        >
          <option value="chat-completions">Chat Completions</option>
          <option value="responses">Responses</option>
          <option value="messages">Messages</option>
        </select>
      </label>
      <div className="provider-bottom">
        <button
          className="text-button danger"
          disabled={!!busy}
          onClick={async () => {
            if (await perform(window.desktop.removeProvider(provider.id))) onDeleted()
          }}
        >
          <Trash2 size={12} />
          {t('deleteProvider')}
        </button>
        {provider.hasKey && (
          <button
            className="text-button muted"
            onClick={() => void perform(window.desktop.removeKey(provider.id))}
          >
            {t('removeKey')}
          </button>
        )}
        <button className="secondary-button" disabled={!!busy} onClick={() => void save()}>
          {t('save')}
        </button>
      </div>
    </div>
  )
}

export function HistoryPage() {
  const { t } = useTranslation()
  const { state, perform, notice } = useApp()
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<HistoryItem[]>([])
  useEffect(() => {
    let stale = false
    const timer = setTimeout(() => {
      void window.desktop.history(query).then((reply) => {
        if (reply.ok && !stale) setItems(reply.data)
      })
    }, 100)
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [query, state])
  return (
    <div className="history-page">
      <SectionTitle
        title={t('historyIntro')}
        action={
          <button
            className="secondary-button"
            onClick={() => void perform(window.desktop.exportData('history'))}
          >
            <Download size={14} />
            {t('exportHistory')}
          </button>
        }
      />
      <div className="search-field history-search">
        <Search size={15} />
        <input
          aria-label={t('searchHistory')}
          value={query}
          placeholder={t('searchHistory')}
          onChange={(event) => setQuery(event.target.value)}
        />
        {query && (
          <button className="icon-button" aria-label={t('clear')} onClick={() => setQuery('')}>
            <X size={13} />
          </button>
        )}
      </div>
      {!items.length ? (
        <EmptyState icon="history" title={t('historyEmpty')} body={t('historyEmptyBody')} />
      ) : (
        <div className="history-list">
          {items.map((item) => (
            <details key={item.id} id={`history-${item.id}`} className="history-card">
              <summary>
                <span className={`history-mode mode-pill ${item.mode}`}>{t(item.mode)}</span>
                <span className="history-preview">{item.input}</span>
                <time>
                  {new Date(item.createdAt).toLocaleString(state.locale, {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                  })}
                </time>
                <ChevronDown size={14} />
              </summary>
              <div className="history-detail">
                <label>{t('original')}</label>
                <pre>{item.input}</pre>
                <label>{t('output')}</label>
                <pre className="history-output">{item.result.outputText}</pre>
                {item.result.changes.map((change, index) => (
                  <p className="history-change" key={index}>
                    <del>{change.from}</del> → <ins>{change.to}</ins>
                    <span>{change.reason}</span>
                  </p>
                ))}
                <div className="history-meta">
                  <code>{item.binding.modelId}</code>
                  <span>
                    {t('tokens', { input: item.usage.input ?? '—', output: item.usage.output ?? '—' })}
                  </span>
                  <button
                    className="text-button"
                    onClick={async () => {
                      await perform(window.desktop.copy(item.result.outputText ?? ''))
                      notice(t('copied'))
                    }}
                  >
                    <Copy size={12} />
                    {t('copy')}
                  </button>
                  <button
                    className="icon-button danger"
                    aria-label={t('delete')}
                    onClick={() => void perform(window.desktop.deleteHistory(item.id))}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            </details>
          ))}
        </div>
      )}
      {state.historyCount > 0 && (
        <div className="settings-tools">
          <span className="muted">
            {state.historyCount.toLocaleString()} {t('rounds', { count: state.historyCount })}
          </span>
          <button
            className="text-button danger"
            onClick={async () => {
              if (window.confirm(t('confirmClear'))) await perform(window.desktop.clearHistory())
            }}
          >
            <Trash2 size={13} />
            {t('clearHistory')}
          </button>
        </div>
      )}
    </div>
  )
}

export function InsightsPage() {
  const { t } = useTranslation()
  const { state, perform } = useApp()
  const [items, setItems] = useState<Insight[]>([])
  useEffect(() => {
    let stale = false
    void window.desktop.insights().then((reply) => {
      if (reply.ok && !stale) setItems(reply.data)
    })
    return () => {
      stale = true
    }
  }, [state])
  const [filter, setFilter] = useState<Insight['status']>('active')
  const visible = items.filter((item) => item.status === filter)
  return (
    <div className="insights-page">
      <SectionTitle
        title={t('insightsIntro')}
        action={
          <button
            className="secondary-button"
            disabled={!state.summaryPendingCount}
            onClick={() => void perform(window.desktop.summarize())}
          >
            <RefreshCw size={14} />
            {t('summarizeNow')}
          </button>
        }
      />
      <div className="summary-progress">
        <span className="status-dot connected" />
        <span>
          {t('summaryProgress', { count: state.summaryPendingCount, every: state.settings.summaryEvery })}
        </span>
      </div>
      {state.jobs.map((job) => (
        <div className="job-status" key={job.id}>
          {job.status === 'running' ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />}
          <div>
            <strong>{t(job.status)}</strong>
            {job.error && (
              <small>{t(`errors.${job.error}`, { defaultValue: t('errors.unexpected_error') })}</small>
            )}
          </div>
          {job.status === 'failed' && (
            <button className="text-button" onClick={() => void perform(window.desktop.retrySummary(job.id))}>
              {t('retry')}
            </button>
          )}
        </div>
      ))}
      <div className="insight-filters">
        {(['active', 'mastered', 'ignored'] as Insight['status'][]).map((status) => (
          <button
            key={status}
            className={filter === status ? 'selected' : ''}
            onClick={() => setFilter(status)}
          >
            {t(status === 'mastered' ? 'masteredState' : status)}
          </button>
        ))}
      </div>
      {!visible.length ? (
        <EmptyState
          icon="insights"
          title={t('insightsEmpty')}
          body={t('insightsEmptyBody', { count: state.settings.summaryEvery })}
        />
      ) : (
        visible.map((item) => (
          <article className="insight-card" key={item.id}>
            <div className="insight-title">
              <span className="insight-symbol">
                <Lightbulb size={17} />
              </span>
              <h3>{item.title}</h3>
              <span className="occurrence-pill">
                {item.count >= 2 ? t('recurring', { count: item.count }) : t('candidate')}
              </span>
            </div>
            <p>{item.explanation}</p>
            <div className="insight-example">
              <del>{item.from}</del>
              <span>→</span>
              <ins>{item.to}</ins>
            </div>
            <div className="insight-actions">
              {item.status === 'active' ? (
                <>
                  <button
                    className="text-button"
                    onClick={() => void perform(window.desktop.insightStatus(item.id, 'mastered'))}
                  >
                    <Check size={12} />
                    {t('mastered')}
                  </button>
                  <button
                    className="text-button muted"
                    onClick={() => void perform(window.desktop.insightStatus(item.id, 'ignored'))}
                  >
                    {t('ignore')}
                  </button>
                </>
              ) : (
                <button
                  className="text-button"
                  onClick={() => void perform(window.desktop.insightStatus(item.id, 'active'))}
                >
                  {t('restore')}
                </button>
              )}
            </div>
            <InsightEvidence item={item} />
          </article>
        ))
      )}
    </div>
  )
}

function InsightEvidence({ item }: { item: Insight }) {
  const { t } = useTranslation()
  const { perform } = useApp()
  const [open, setOpen] = useState(false)
  const [records, setRecords] = useState<HistoryItem[]>([])
  useEffect(() => {
    if (!open) return
    let stale = false
    void perform(window.desktop.historyItems(item.historyIds.slice(0, 1000))).then((data) => {
      if (data && !stale) setRecords(data)
    })
    return () => {
      stale = true
    }
  }, [open, item.historyIds.join(',')])
  return (
    <div className="insight-evidence">
      <button className="text-button" aria-expanded={open} onClick={() => setOpen(!open)}>
        <ChevronDown size={12} />
        {t('evidence')} ({item.historyIds.length})
      </button>
      {open && (
        <div className="history-list">
          {records.map((record) => (
            <details key={record.id} className="history-card evidence-card">
              <summary>
                <span className="history-preview">{record.input}</span>
                <ChevronDown size={12} />
              </summary>
              <div className="history-detail">
                <label>{t('original')}</label>
                <pre>{record.input}</pre>
                <label>{t('output')}</label>
                <pre className="history-output">{record.result.outputText}</pre>
              </div>
            </details>
          ))}
        </div>
      )}
    </div>
  )
}

function EmptyState({ icon, title, body }: { icon: 'history' | 'insights'; title: string; body: string }) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">
        {icon === 'history' ? (
          <FileText size={25} strokeWidth={1.3} />
        ) : (
          <Lightbulb size={25} strokeWidth={1.3} />
        )}
      </div>
      <h3>{title}</h3>
      <p>{body}</p>
    </div>
  )
}
