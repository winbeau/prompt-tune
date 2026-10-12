import { Minus, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export function WindowControls() {
  const { t } = useTranslation()
  if (window.platform !== 'darwin') return null
  return (
    <div className="window-controls">
      <button
        className="window-control window-close"
        aria-label={t('shortcutClose')}
        title={t('shortcutClose')}
        onClick={() => void window.desktop.closeWindow()}
      >
        <X size={8} strokeWidth={2.5} />
      </button>
      <button
        className="window-control window-minimize"
        aria-label={t('minimize')}
        title={t('minimize')}
        onClick={() => void window.desktop.minimizeWindow()}
      >
        <Minus size={8} strokeWidth={2.5} />
      </button>
    </div>
  )
}
