import type { DesktopAPI } from '../../shared/types'
declare global {
  interface Window {
    desktop: DesktopAPI
    platform: string
    onSettingsTab(listener: (tab: string) => void): () => void
  }
}
export {}
