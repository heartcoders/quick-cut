/**
 * Hybrid-Record-Button: kurz tippen = Aufnahme bis zum nächsten Tippen,
 * halten = Aufnahme solange der Finger liegt. Reine Logik ohne DOM.
 */
export const HOLD_THRESHOLD_MS = 300

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
