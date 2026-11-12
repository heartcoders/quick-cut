/**
 * Hybrid-Record-Button: kurz tippen = Aufnahme bis zum nächsten Tippen,
 * halten = Aufnahme solange der Finger liegt. Reine Logik ohne DOM.
 */
export const HOLD_THRESHOLD_MS = 300

/** Halten und nach oben wischen = zoomen. Unterhalb dieser Strecke passiert nichts. */
export const ZOOM_DEAD_ZONE_PX = 12
/** Anteil der Bildschirmhöhe für den vollen Zoomweg. */
export const ZOOM_DRAG_SHARE = 0.4

/** Wischstrecke nach oben (px, positiv = nach oben) → Zoomfortschritt 0–1. */
export function dragProgress(dy: number, viewportHeight: number): number {
  const span = Math.max(1, viewportHeight * ZOOM_DRAG_SHARE)
  return Math.min(1, Math.max(0, (dy - ZOOM_DEAD_ZONE_PX) / span))
}

export type ButtonState = 'idle' | 'pressing' | 'recording-tap'

export type ButtonEvent =
  | { type: 'down'; at: number }
  | { type: 'up'; at: number }
  | { type: 'cancel' } // pointercancel
  | { type: 'interrupt' } // App im Hintergrund, Zeitlimit, Screen verlassen

export type ButtonEffect = 'start' | 'stop' | null

export interface MachineState {
  state: ButtonState
  pressedAt: number
}

export const initialMachine: MachineState = { state: 'idle', pressedAt: 0 }

export function transition(
  m: MachineState,
  e: ButtonEvent,
): { next: MachineState; effect: ButtonEffect } {
  const idle = { next: initialMachine, effect: 'stop' as const }
  const same = { next: m, effect: null }

  if (e.type === 'interrupt') return m.state === 'idle' ? same : idle

  switch (m.state) {
    case 'idle':
      return e.type === 'down'
        ? { next: { state: 'pressing', pressedAt: e.at }, effect: 'start' }
        : same
    case 'pressing':
      if (e.type === 'up') {
        return e.at - m.pressedAt < HOLD_THRESHOLD_MS
          ? { next: { ...m, state: 'recording-tap' }, effect: null }
          : idle
      }
      if (e.type === 'cancel') return idle
      return same // zweites down (Multitouch) ignorieren
    case 'recording-tap':
      return e.type === 'down' ? idle : same
  }
}
