import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  Clipboard,
  Copy,
  History,
  LoaderCircle,
  Pin,
  Settings2,
  Sparkles,
  Square,
  X
} from 'lucide-react'
import type { Mode, PromptResult } from '../../shared/types'
import { useApp } from './App'

export function Editor() {
  const { t } = useTranslation()
  const { state, perform } = useApp()
  const [mode, setMode] = useState<Mode>('tune')
  const [text, setText] = useState('')
  const [result, setResult] = useState<PromptResult>()
  const [preview, setPreview] = useState('')
  const [busy, setBusy] = useState(false)
  const [save, setSave] = useState(true)
  const [copied, setCopied] = useState(false)
  const [failure, setFailure] = useState('')
  const [expanded, setExpanded] = useState(false)
  const current = useRef<{ id: string; text: string; mode: Mode } | undefined>(undefined)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const binding = state.settings.bindings[mode]
  const provider = state.providers.find((item) => item.id === binding.providerId)
  const model = provider?.models.find((item) => item.id === binding.modelId)
  const ready =
    !!provider &&
    provider.enabled &&
    (!provider.requiresKey || provider.hasKey) &&
    !!model?.enabled &&
    model.protocol !== 'unsupported'
  const options = state.providers
    .filter((provider) => provider.enabled)
    .flatMap((provider) =>
      provider.models
        .filter((model) => model.enabled && model.protocol !== 'unsupported')
        .map((model) => ({ provider, model }))
    )
  useEffect(
    () =>
      window.desktop.onRun((event) => {
        if (event.id !== current.current?.id) return
        if (event.type === 'preview') setPreview(event.text ?? '')
        if (event.type === 'done') {
          setResult(event.result)
          setBusy(false)
          setPreview('')
          setFailure('')
        }
        if (event.type === 'error') {
          setBusy(false)
          setPreview('')
          setFailure(
            event.error === 'canceled'
              ? ''
              : t(`errors.${event.error}`, { defaultValue: t('errors.unexpected_error') })
          )
        }
      }),
    [t]
  )
  const runRef = useRef<() => void>(() => {})
  runRef.current = () => void run()
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !event.isComposing) {
        event.preventDefault()
        runRef.current()
      }
    }
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])
  async function run() {
    if (busy) return
    if (!ready) {
      await perform(window.desktop.openSettings('models'))
      return
    }
    if (!text.trim()) {
      inputRef.current?.focus()
      return
    }
    if (!current.current || current.current.text !== text || current.current.mode !== mode)
      current.current = { id: crypto.randomUUID(), text, mode }
    setBusy(true)
    setFailure('')
    setResult(undefined)
    setPreview('')
    setExpanded(false)
    setCopied(false)
    const reply = await perform(
      window.desktop.run({ ...current.current, save: save && state.settings.saveHistory, binding })
    )
    if (reply === undefined) setBusy(false)
  }
  function reset(value: string, nextMode = mode) {
    if (busy && current.current) void window.desktop.cancel(current.current.id)
    current.current = undefined
    setBusy(false)
    setText(value)
    setMode(nextMode)
    setResult(undefined)
    setFailure('')
    setPreview('')
    setCopied(false)
  }
  async function copy() {
    if (result?.outputText) {
      await perform(window.desktop.copy(result.outputText))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }
  return (
    <>
      <header className="titlebar editor-title">
        <span className="brand-title">
          PromptTune
          <span className="brand-dot" />
        </span>
        <div className="title-actions">
          <button
            className={`icon-button ${state.settings.alwaysOnTop ? 'active-pin' : ''}`}
            title={t(state.settings.alwaysOnTop ? 'unpin' : 'pin')}
            aria-label={t('pin')}
            onClick={() =>
              void perform(
                window.desktop.saveSettings({ ...state.settings, alwaysOnTop: !state.settings.alwaysOnTop })
              )
            }
          >
            <Pin size={15} />
          </button>
          <button
            className="icon-button"
            title={t('history')}
            aria-label={t('history')}
            onClick={() => void perform(window.desktop.openSettings('history'))}
          >
            <History size={16} />
          </button>
          <button
            className="icon-button"
            title={`${t('settings')} ⌘,`}
            aria-label={t('settings')}
            onClick={() => void perform(window.desktop.openSettings())}
          >
            <Settings2 size={16} />
          </button>
          {window.platform !== 'darwin' && (
            <button
              className="icon-button"
              aria-label={t('shortcutClose')}
              onClick={() => void window.desktop.closeWindow()}
            >
              <X size={16} />
            </button>
          )}
        </div>
      </header>
      <main className="editor-main">
        <div className="editor-intro">
          <div className="wordmark">
            p<span>·</span>
          </div>
          <div>
            <h1>{t('tagline')}</h1>
            <p>{t(mode === 'tune' ? 'tuneHint' : 'translateHint')}</p>
          </div>
        </div>
        <div className="mode-switch" aria-label="Mode">
          {(['translate', 'tune'] as Mode[]).map((value) => (
            <button
              className={mode === value ? 'selected' : ''}
              key={value}
              aria-pressed={mode === value}
              onClick={() => reset(text, value)}
            >
              <span>{t(value)}</span>
              <span className="mode-direction">{t(value === 'translate' ? 'cnEn' : 'enEn')}</span>
            </button>
          ))}
        </div>
        {!ready && (
          <div className="setup-banner">
            <span className="setup-icon">
              <Sparkles size={18} />
            </span>
            <div>
              <strong>{t('setupTitle')}</strong>
              <p>{t('setupBody')}</p>
            </div>
            <button
              className="icon-button"
              aria-label={t('connect')}
              onClick={() => void perform(window.desktop.openSettings('models'))}
            >
              <ArrowUpRight size={19} />
            </button>
          </div>
        )}
        <section className="input-card">
          <div className="card-label">
            <label htmlFor="prompt-input">{t('source')}</label>
            <div>
              <button
                className="text-button"
                onClick={async () => {
                  const pasted = await perform(window.desktop.paste())
                  if (pasted !== undefined) reset(pasted)
                }}
              >
                <Clipboard size={12} />
                {t('paste')}
              </button>
              {text && (
                <button className="icon-button" aria-label={t('clear')} onClick={() => reset('')}>
                  <X size={13} />
                </button>
              )}
            </div>
          </div>
          <textarea
            ref={inputRef}
            id="prompt-input"
            maxLength={20000}
            value={text}
            onChange={(event) => reset(event.target.value)}
            spellCheck={false}
            autoFocus
            placeholder={t(mode === 'translate' ? 'inputTranslate' : 'inputTune')}
          />
          <div className="input-meta">
            <span>{text.length.toLocaleString()} / 20,000</span>
            <span className="kbd-hint">{window.platform === 'darwin' ? '⌘' : 'Ctrl'} ↵</span>
          </div>
        </section>
        <div className="run-row">
          <div className="model-picker">
            <span className={`status-dot ${ready ? 'connected' : ''}`} />
            <select
              aria-label={t('model')}
              value={JSON.stringify(binding)}
              disabled={busy || !options.length}
              onChange={(event) =>
                void perform(
                  window.desktop.saveSettings({
                    ...state.settings,
                    bindings: { ...state.settings.bindings, [mode]: JSON.parse(event.target.value) }
                  })
                )
              }
            >
              {!options.length && <option>{t('noModel')}</option>}
              {options.map(({ provider, model }) => (
                <option
                  key={`${provider.id}/${model.id}`}
                  value={JSON.stringify({ providerId: provider.id, modelId: model.id })}
                >
                  {provider.name} · {model.name}
                </option>
              ))}
            </select>
            <ChevronDown size={12} />
          </div>
          <button
            className={`primary-button ${busy ? 'stop-button' : ''}`}
            onClick={() =>
              busy && current.current ? void perform(window.desktop.cancel(current.current.id)) : void run()
            }
            disabled={ready && !busy && !text.trim()}
          >
            {busy ? (
              <>
                <Square size={13} />
                {t('stop')}
              </>
            ) : (
              <>
                {t(ready ? (mode === 'translate' ? 'runTranslate' : 'runTune') : 'connect')}
                <ArrowRight size={15} />
              </>
            )}
          </button>
        </div>
        <section
          className={`output-card ${result?.outputText ? 'has-result' : ''}`}
          aria-live="polite"
          aria-busy={busy}
        >
          <div className="card-label">
            <span>{t('result')}</span>
            <span className="language-pill">EN</span>
          </div>
          {failure ? (
            <div className="inline-error" role="alert">
              {failure}
              <button className="text-button" onClick={() => void run()}>
                {t('retry')}
                <ArrowRight size={12} />
              </button>
            </div>
          ) : busy ? (
            <div className="result-text">
              {preview || (
                <div className="processing">
                  <LoaderCircle size={16} className="spin" />
                  {t('processing')}
                </div>
              )}
            </div>
          ) : result?.status === 'needs_clarification' ? (
            <div className="clarification">
              <strong>{t('clarification')}</strong>
              {result.ambiguities.map((value, index) => (
                <p key={index}>{value}</p>
              ))}
            </div>
          ) : result?.outputText ? (
            <div className="result-text" data-testid="result-text">
              {result.outputText}
            </div>
          ) : (
            <div className="output-empty">
              <span className="empty-lines">
                <i />
                <i />
                <i />
              </span>
              <strong>{t('waitingTitle')}</strong>
              <p>{t('waitingBody')}</p>
            </div>
          )}
          {result?.outputText && (
            <div className="result-actions">
              <button className="text-button" onClick={() => setExpanded(!expanded)}>
                {result.changes.length ? t('changes', { count: result.changes.length }) : t('noChanges')}
                {result.changes.length > 0 && <ChevronDown className={expanded ? 'rotated' : ''} size={13} />}
              </button>
              <button className="copy-button" onClick={() => void copy()}>
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {t(copied ? 'copied' : 'copy')}
              </button>
            </div>
          )}
        </section>
        {expanded && result && result.changes.length > 0 && (
          <div className="changes-list">
            {result.changes.map((change, index) => (
              <article className="change-card" key={index}>
                <div>
                  <span className={`change-tag ${change.kind}`}>{t(change.kind)}</span>
                  <span className="change-diff">
                    <del>{change.from}</del>
                    <ArrowRight size={12} />
                    <ins>{change.to}</ins>
                  </span>
                </div>
                <p>{change.reason}</p>
                {change.kind === 'correction' && current.current && (
                  <button
                    className="text-button muted"
                    onClick={async () => {
                      await perform(window.desktop.rejectChange(current.current!.id, change.from))
                      setResult({ ...result, changes: result.changes.filter((_, i) => i !== index) })
                    }}
                  >
                    {t('dismissChange')}
                  </button>
                )}
              </article>
            ))}
          </div>
        )}
      </main>
      <footer className="editor-footer">
        <label>
          <input
            type="checkbox"
            checked={save && state.settings.saveHistory}
            disabled={!state.settings.saveHistory}
            onChange={(event) => setSave(event.target.checked)}
          />
          <span>{t('saveRound')}</span>
        </label>
        <span
          title={t(save && state.settings.saveHistory ? 'saveHint' : 'notSaved', {
            count: state.settings.summaryEvery
          })}
        >
          {state.settings.autoSummary && save && state.settings.saveHistory
            ? `${state.summaryPendingCount % state.settings.summaryEvery} / ${state.settings.summaryEvery}`
            : t('footer')}
        </span>
      </footer>
    </>
  )
}
