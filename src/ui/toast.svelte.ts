export type ToastKind = 'info' | 'warn' | 'error'

export interface Toast {
  id: number
  text: string
  kind: ToastKind
}

const DURATION_MS = 4000
const MAX_VISIBLE = 3

class Toasts {
  items = $state<Toast[]>([])
  #next = 1

  show(text: string, kind: ToastKind = 'info', durationMs = DURATION_MS): void {
    // Gleichen Text nicht doppelt stapeln (z. B. mehrere fehlerhafte Importe).
    if (this.items.some((t) => t.text === text)) return
    const id = this.#next++
    this.items.push({ id, text, kind })
    if (this.items.length > MAX_VISIBLE) this.items.shift()
    setTimeout(() => this.dismiss(id), durationMs)
  }

  dismiss(id: number): void {
    const i = this.items.findIndex((t) => t.id === id)
    if (i >= 0) this.items.splice(i, 1)
  }
}

export const toasts = new Toasts()
