import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { X, Settings2, History, Lightbulb, SlidersHorizontal, Check, LoaderCircle } from 'lucide-react'
import type { AppState, Reply } from '../../shared/types'
import i18n from './i18n'
import { Editor } from './Editor'
import { WindowControls } from './WindowControls'
import { General, Models, HistoryPage, InsightsPage } from './Settings'

type Context = {
  state: AppState
  perform<T>(promise: Promise<Reply<T>>): Promise<T | undefined>
  notice(message: string): void
}
const AppContext = createContext<Context | null>(null)
export const useApp = (): Context => useContext(AppContext)!

export function App() {
  const { t } = useTranslation()
  const [state, setState] = useState<AppState>()
  const [message, setMessage] = useState('')
  const [error, setError] = useState(false)
  const settings = new URLSearchParams(location.search).get('window') === 'settings'
  const [tab, setTab] = useState(location.hash.slice(1) || 'general')
  useEffect(() => {
    void window.desktop.state().then((reply) => {
      if (reply.ok) setState(reply.data)
      else {
        setMessage(reply.error)
        setError(true)
      }
    })
    return window.desktop.onState(setState)
  }, [])
  useEffect(() => {
    if (state) {
      void i18n.changeLanguage(state.locale)
      document.documentElement.lang = state.locale
    }
  }, [state?.locale])
  useEffect(() => {
    if (message) {
      const timer = setTimeout(() => setMessage(''), 6000)
      return () => clearTimeout(timer)
    }
  }, [message])
  useEffect(() => window.onSettingsTab(setTab), [])
  useEffect(() => {
    const preference = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      document.documentElement.dataset.theme =
        state?.settings.theme === 'system' || !state?.settings.theme
          ? preference.matches
            ? 'black'
            : 'light'
          : state.settings.theme
    }
    apply()
    preference.addEventListener('change', apply)
    return () => preference.removeEventListener('change', apply)
  }, [state?.settings.theme])
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === ',') {
        event.preventDefault()
        void window.desktop.openSettings()
      }
      if (event.key === 'Escape' && !event.isComposing) {
        if (document.querySelector('dialog[open]')) return
        if (message) setMessage('')
        else void window.desktop.closeWindow()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [message])
  async function perform<T>(promise: Promise<Reply<T>>): Promise<T | undefined> {
    try {
      const reply = await promise
      if (reply.ok) return reply.data
      setError(true)
      setMessage(t(`errors.${reply.error}`, { defaultValue: t('errors.unexpected_error') }))
    } catch {
      setError(true)
      setMessage(t('errors.unexpected_error'))
    }
    return undefined
  }
  function notice(value: string) {
    setError(false)
    setMessage(value)
  }
  if (!state)
    return (
      <div className="loading-app">
        <LoaderCircle className="spin" />
        <span>PromptTune</span>
        {message && <p>{message}</p>}
      </div>
    )
  const tabs = [
    { id: 'general', icon: SlidersHorizontal },
    { id: 'models', icon: Settings2 },
    { id: 'history', icon: History },
    { id: 'insights', icon: Lightbulb }
  ]
  return (
    <AppContext.Provider value={{ state, perform, notice }}>
      <div
        className={`app-shell ${settings ? 'settings-shell' : 'editor-shell'} ${window.platform === 'darwin' ? 'mac' : ''}`}
      >
        {settings ? (
          <>
            <header className="titlebar settings-title">
              <WindowControls />
              <span className="window-title">
                PromptTune <span>/ {t('settings')}</span>
              </span>
              {window.platform !== 'darwin' && (
                <button
                  className="icon-button"
                  onClick={() => void window.desktop.closeWindow()}
                  aria-label={t('shortcutClose')}
                >
                  <X size={16} />
                </button>
              )}
            </header>
            <nav className="settings-tabs" aria-label={t('settings')}>
              {tabs.map(({ id, icon: Icon }) => (
                <button
                  key={id}
                  className={tab === id ? 'selected' : ''}
                  onClick={() => {
                    setTab(id)
                    location.hash = id
                  }}
                >
                  <Icon size={15} />
                  {t(id)}
                </button>
              ))}
            </nav>
            <div className="settings-content">
              {tab === 'models' ? (
                <Models />
              ) : tab === 'history' ? (
                <HistoryPage />
              ) : tab === 'insights' ? (
                <InsightsPage />
              ) : (
                <General />
              )}
            </div>
            <footer className="settings-footer">
              <span className="wordmark-mini">
                p<span>·</span>
              </span>
              <span>PromptTune {state.version}</span>
              <span>MIT</span>
            </footer>
          </>
        ) : (
          <Editor />
        )}
        {message && (
          <div className={`toast ${error ? 'error-toast' : ''}`} role={error ? 'alert' : 'status'}>
            {error ? <span className="error-dot" /> : <Check size={15} />}
            <span>{message}</span>
            <button className="icon-button" onClick={() => setMessage('')} aria-label={t('shortcutClose')}>
              <X size={14} />
            </button>
          </div>
        )}
      </div>
    </AppContext.Provider>
  )
}

export function SectionTitle({
  title,
  description,
  action
}: {
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="section-heading">
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action}
    </div>
  )
}
export function Toggle({
  label,
  description,
  checked,
  onChange
}: {
  label: string
  description?: string
  checked: boolean
  onChange(value: boolean): void
}) {
  return (
    <label className="toggle-row">
      <span>
        <strong>{label}</strong>
        {description && <small>{description}</small>}
      </span>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="toggle-track" aria-hidden="true" />
    </label>
  )
}
