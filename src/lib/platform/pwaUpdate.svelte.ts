import { registerSW } from 'virtual:pwa-register'
import { router } from '../router.svelte'

/** Wie oft eine offene App zusätzlich nach Updates fragt. */
const CHECK_INTERVAL_MS = 60 * 60 * 1000

/**
 * Service-Worker-Updates. iOS prüft bei Home-Bildschirm-Apps selten von selbst,
 * deshalb fragen wir bei jedem Zurückholen der App und stündlich nach. Ein neuer
 * Service Worker übernimmt sofort (autoUpdate). Die Seite lädt aber nur auf
 * Start oder Einstellungen neu – nie mitten in Aufnahme, Schnitt oder Export.
 */
class PwaUpdate {
  /** Neue Version aktiv, Neuladen steht noch aus. */
  pending = $state(false)
  checking = $state(false)
  /** Service Worker registriert → Update-Prüfung möglich. */
  supported = $state(false)
  #reg: ServiceWorkerRegistration | undefined

  start(): void {
    if (!('serviceWorker' in navigator)) return
    registerSW({
      immediate: true,
      onRegisteredSW: (_url, reg) => {
        this.#reg = reg
        if (!reg) return
        this.supported = true
        setInterval(() => void this.check(), CHECK_INTERVAL_MS)
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') void this.check()
        })
      },
      onNeedReload: () => {
        this.pending = true
        this.reloadIfIdle()
      },
    })
  }

  /** Auf dem Server nach einer neuen Version fragen. */
  async check(): Promise<void> {
    if (!this.#reg || this.checking || !navigator.onLine) return
    this.checking = true
    try {
      await this.#reg.update()
    } catch (err) {
      console.warn('Update-Prüfung fehlgeschlagen', err)
    } finally {
      this.checking = false
    }
  }

  /** Neu laden, falls ein Update wartet und gerade nichts läuft. */
  reloadIfIdle(): void {
    if (this.pending && (router.current === 'home' || router.current === 'settings')) location.reload()
  }
}

export const pwaUpdate = new PwaUpdate()
