import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowRight,
  Check,
  ChevronDown,
  Copy,
  History,
  LoaderCircle,
  Pin,
  Settings2,
  Square,
  X
} from 'lucide-react'
import type { Mode, PromptResult } from '../../shared/types'
import { useApp } from './App'
import { WindowControls } from './WindowControls'

function useTextHeight(value: string, widthRef: React.RefObject<HTMLElement | null>) {
  const mirror = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(98)
  useLayoutEffect(() => {
    const measure = () => {
      if (mirror.current) {
        const lineHeight = Number.parseFloat(getComputedStyle(mirror.current).lineHeight)
        const contentHeight = mirror.current.getBoundingClientRect().height + 2
        setHeight(Math.ceil(Math.max(lineHeight * 3 + 24, contentHeight)))
      }
    }
    measure()
    const observer = new ResizeObserver(measure)
    if (widthRef.current) observer.observe(widthRef.current)
    if (mirror.current) observer.observe(mirror.current)
    return () => observer.disconnect()
  }, [value])
  return { mirror, height }
}

function useStreamPreview(target: string, active: boolean): string {
  const [visible, setVisible] = useState('')
  const cursor = useRef(0)
  useEffect(() => {
    if (!active || !target) {
      cursor.current = 0
      setVisible('')
      return
    }
    const characters = Array.from(target)
    let frame: number
    const advance = () => {
      cursor.current = Math.min(
        characters.length,
        cursor.current + Math.max(1, Math.ceil((characters.length - cursor.current) / 5))
      )
      setVisible(characters.slice(0, cursor.current).join(''))
      if (cursor.current < characters.length) frame = requestAnimationFrame(advance)
    }
    frame = requestAnimationFrame(advance)
    return () => cancelAnimationFrame(frame)
  }, [target, active])
  return visible
}

export function Editor() {
  const { t } = useTranslation()
  const { state, perform } = useApp()
  const [mode, setMode] = useState<Mode>('tune')
  const [text, setText] = useState('')
  const [result, setResult] = useState<PromptResult>()
  const [preview, setPreview] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [failure, setFailure] = useState('')
  const [expanded, setExpanded] = useState(false)
  const current = useRef<{ id: string; text: string; mode: Mode } | undefined>(undefined)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const inputBox = useRef<HTMLDivElement>(null)
  const outputBox = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const smoothPreview = useStreamPreview(preview, busy)
  const output = busy
    ? smoothPreview
    : result?.status === 'completed'
      ? (result.outputText ?? '')
      : (result?.ambiguities.join('\n') ?? '')
  const inputMeasure = useTextHeight(text, inputBox)
  const outputMeasure = useTextHeight(output || failure, outputBox)
  const binding = state.settings.bindings[mode]
  const provider = state.providers.find((item) => item.id === binding.providerId)
  const model = provider?.models.find((item) => item.id === binding.modelId)
  const ready =
    !!provider?.enabled &&
    (!provider.requiresKey || provider.hasKey) &&
    !!model?.enabled &&
    model.protocol !== 'unsupported'
  const connected = ready && provider?.status === 'ready'
  const options = state.providers
    .filter((provider) => provider.enabled)
    .flatMap((provider) =>
      provider.models
        .filter((model) => model.enabled && model.protocol !== 'unsupported')
        .map((model) => ({ provider, model }))
    )

  useLayoutEffect(() => {
    const element = contentRef.current
    if (!element) return
    const observer = new ResizeObserver(() => {
      void window.desktop.resizeContent(element.getBoundingClientRect().height + 40)
    })
    observer.observe(element)
    return () => {
      observer.disconnect()
    }
  }, [])
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
      if (
        event.key !== 'Enter' ||
        event.shiftKey ||
        event.altKey ||
        event.isComposing ||
        event.keyCode === 229
      )
        return
      const target = event.target
      // Enter submits from the mode switch too; Space still toggles it normally.
      if (
        target !== inputRef.current &&
        !(target instanceof Element && target.closest('.mode-slider')) &&
        !event.metaKey &&
        !event.ctrlKey
      )
        return
      event.preventDefault()
      if (event.repeat) return
      runRef.current()
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
      window.desktop.run({ ...current.current, save: state.settings.saveHistory, binding })
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
    if (busy || result?.status !== 'completed' || !result.outputText) return
    if ((await perform(window.desktop.copy(result.outputText))) === undefined) return
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <>
      <header className="titlebar compact-title">
        <WindowControls />
        <span className="brand-title">
          PromptTune
          <button
            className={`api-indicator ${connected ? 'connected' : provider?.status === 'error' || provider?.status === 'auth_error' ? 'failed' : ''}`}
            aria-label={t(connected ? 'apiConnected' : 'apiSetup')}
            title={t(connected ? 'apiConnected' : 'apiSetup')}
            onClick={() => void perform(window.desktop.openSettings('models'))}
          >
            <span />
          </button>
        </span>
        <div className="title-actions">
          <button
            className={`icon-button ${state.settings.alwaysOnTop ? 'active-pin' : ''}`}
            aria-label={t('pin')}
            title={t(state.settings.alwaysOnTop ? 'unpin' : 'pin')}
            onClick={() =>
              void perform(
                window.desktop.saveSettings({ ...state.settings, alwaysOnTop: !state.settings.alwaysOnTop })
              )
            }
          >
            <Pin size={14} />
          </button>
          <button
            className="icon-button"
            aria-label={t('history')}
            title={t('history')}
            onClick={() => void perform(window.desktop.openSettings('history'))}
          >
            <History size={15} />
          </button>
          <button
            className="icon-button"
            aria-label={t('settings')}
            title={t('settings')}
            onClick={() => void perform(window.desktop.openSettings())}
          >
            <Settings2 size={15} />
          </button>
          {window.platform !== 'darwin' && (
            <button
              className="icon-button"
              aria-label={t('shortcutClose')}
              onClick={() => void window.desktop.closeWindow()}
            >
              <X size={14} />
            </button>
          )}
        </div>
      </header>
      <main className="compact-scroll">
        <div className="compact-content" ref={contentRef}>
          <div className="compact-intro">
            <h1>Your intent. Clearer English.</h1>
            <div className="compact-mode">
              <span className={`mode-pill ${mode}`} aria-live="polite">
                {mode === 'translate' ? 'CN → EN' : 'EN → EN'}
              </span>
              <button
                className="mode-slider"
                role="switch"
                aria-label={t('switchMode')}
                aria-checked={mode === 'translate'}
                onClick={() => {
                  reset(text, mode === 'tune' ? 'translate' : 'tune')
                  inputRef.current?.focus()
                }}
              >
                <span />
              </button>
            </div>
          </div>
          <div className="compact-field" ref={inputBox} style={{ height: inputMeasure.height }}>
            <div className="text-mirror" ref={inputMeasure.mirror} aria-hidden="true">
              {text}
              {'\u200b'}
            </div>
            <textarea
              id="prompt-input"
              aria-label={t('source')}
              title={t('newline')}
              ref={inputRef}
              rows={3}
              maxLength={20000}
              value={text}
              onChange={(event) => reset(event.target.value)}
              placeholder={t(mode === 'translate' ? 'inputTranslate' : 'inputTune')}
              spellCheck={false}
              autoFocus
            />
          </div>
          <div className="compact-run-row">
            <div className="model-picker">
              <select
                aria-label={t('model')}
                value={JSON.stringify(binding)}
                disabled={busy || !options.length}
                onChange={(event) => {
                  reset(text)
                  void perform(
                    window.desktop.saveSettings({
                      ...state.settings,
                      bindings: { ...state.settings.bindings, [mode]: JSON.parse(event.target.value) }
                    })
                  )
                }}
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
              <ChevronDown size={11} />
            </div>
            <div className="compact-actions">
              <button
                className={`primary-button compact-submit ${mode} ${busy ? 'is-running' : ''}`}
                aria-label={t(busy ? 'stop' : mode === 'translate' ? 'runTranslate' : 'runTune')}
                title={ready ? 'Return' : t('apiSetup')}
                disabled={ready && !busy && !text.trim()}
                onClick={() =>
                  busy && current.current
                    ? void perform(window.desktop.cancel(current.current.id))
                    : void run()
                }
              >
                {busy ? (
                  <>
                    <LoaderCircle className="spin" size={13} />
                    <span>{t('stop')}</span>
                    <Square size={9} />
                  </>
                ) : (
                  <>
                    <span>{t(mode === 'translate' ? 'translate' : 'tune')}</span>
                    <kbd>↵</kbd>
                  </>
                )}
              </button>
              <button
                className={`icon-button compact-copy ${copied ? 'copied' : ''}`}
                aria-label={t(copied ? 'copied' : 'copy')}
                title={t(copied ? 'copied' : 'copy')}
                disabled={busy || result?.status !== 'completed' || !result.outputText}
                onClick={() => void copy()}
              >
                {copied ? <Check size={15} /> : <Copy size={15} />}
              </button>
            </div>
          </div>
          <div
            className={`compact-field compact-output ${busy ? 'streaming' : ''} ${failure ? 'has-error' : ''}`}
            ref={outputBox}
            style={{ height: outputMeasure.height }}
            aria-busy={busy}
            aria-live="polite"
            aria-label={t('result')}
          >
            <div className="text-mirror" ref={outputMeasure.mirror} aria-hidden="true">
              {output || failure}
              {busy ? <span className="stream-caret" /> : '\u200b'}
            </div>
            <div
              className={`compact-result ${busy ? 'streaming-text' : ''}`}
              data-testid={result?.status === 'completed' && !busy ? 'result-text' : undefined}
            >
              {failure || output}
              {busy && <span className="stream-caret" />}
            </div>
          </div>
          {result?.changes.length ? (
            <div className="compact-edit-notes">
              <button
                className="text-button"
                aria-expanded={expanded}
                aria-controls="edit-details"
                onClick={() => setExpanded(!expanded)}
              >
                {t('changes', { count: result.changes.length })}
                <ChevronDown size={12} className={expanded ? 'rotated' : ''} />
              </button>
              {expanded && (
                <div className="changes-list" id="edit-details">
                  {result.changes.map((change, index) => (
                    <article className="change-card" key={index}>
                      <div className="change-heading">
                        <span className={`change-tag ${change.kind}`}>
                          {change.kind === 'correction' && <Check size={11} aria-hidden="true" />}
                          {t(change.kind)}
                        </span>
                        {change.kind === 'correction' && current.current && (
                          <button
                            className="icon-button change-dismiss"
                            aria-label={t('dismissChange')}
                            title={t('dismissChange')}
                            onClick={async () => {
                              await perform(window.desktop.rejectChange(current.current!.id, change.from))
                              setResult({ ...result, changes: result.changes.filter((_, i) => i !== index) })
                            }}
                          >
                            <X size={13} />
                          </button>
                        )}
                      </div>
                      <div className="change-diff">
                        <del>{change.from}</del>
                        <ArrowRight size={14} aria-hidden="true" />
                        <ins>{change.to}</ins>
                      </div>
                      <p>{change.reason}</p>
                    </article>
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </div>
      </main>
    </>
  )
}
