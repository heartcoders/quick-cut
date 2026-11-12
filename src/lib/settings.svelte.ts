import type { Facing } from './capture/camera'

export type DefaultFacing = Facing | 'last'

export interface Settings {
  /** Kamera beim Öffnen der Aufnahme: vorne, hinten oder die zuletzt benutzte. */
  defaultFacing: DefaultFacing
}

const KEY = 'quick-cut.settings'
const DEFAULTS: Settings = { defaultFacing: 'last' }

export function parseSettings(raw: string | null): Settings {
  try {
    const p = JSON.parse(raw ?? '{}') as Partial<Settings>
    const facing = (['user', 'environment', 'last'] as const).find((f) => f === p.defaultFacing)
    return { defaultFacing: facing ?? DEFAULTS.defaultFacing }
  } catch {
    return { ...DEFAULTS }
  }
}

function read(): Settings {
  try {
    return parseSettings(localStorage.getItem(KEY))
  } catch {
    return { ...DEFAULTS } // Privater Modus o. Ä.
  }
}

class SettingsStore {
  value = $state<Settings>(read())

  set<K extends keyof Settings>(key: K, v: Settings[K]): void {
    this.value[key] = v
    try {
      localStorage.setItem(KEY, JSON.stringify(this.value))
    } catch {
      // ohne Speichern weiter
    }
  }
}

export const settings = new SettingsStore()
