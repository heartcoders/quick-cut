/**
 * Instant-Aufnahme vom Startscreen: Der Finger liegt auf dem Record-Button des
 * Startscreens, der beim Wechsel in die Aufnahme verschwindet. Dieses Modul
 * verfolgt den Finger weiter (auf `window`), bis der Aufnahme-Screen ihn übernimmt.
 */
export interface InstantHold {
  /** Zeitstempel des Drückens (`event.timeStamp`, gleiche Uhr wie `performance.now()`) */
  pressedAt: number
  startY: number
  released: boolean
  releasedAt: number
  onRelease?: (at: number) => void
  onMove?: (y: number) => void
}

let current: InstantHold | null = null

/** Vom Startscreen beim `pointerdown` aufrufen. */
export function beginInstantHold(e: PointerEvent): void {
  const hold: InstantHold = { pressedAt: e.timeStamp, startY: e.clientY, released: false, releasedAt: 0 }
  current = hold
  const target = e.target
  const pointerId = e.pointerId

  // Zeiger an ein Element binden, das bestehen bleibt – sonst verliert der Browser
  // ihn, wenn der Button verschwindet.
  const root = document.documentElement
  try {
    root.setPointerCapture(pointerId)
  } catch {
    // nicht schlimm, die Listener auf window greifen trotzdem meist
  }

  const release = (at: number) => {
    if (hold.released) return
    hold.released = true
    hold.releasedAt = at
    cleanup()
    hold.onRelease?.(at)
  }
  const onPointerEnd = (ev: PointerEvent) => ev.pointerId === pointerId && release(ev.timeStamp)
  const onPointerMove = (ev: PointerEvent) => ev.pointerId === pointerId && hold.onMove?.(ev.clientY)
  // WebKit schickt Touch-Events weiter an das ursprüngliche (entfernte) Element.
  const onTouchEnd = (ev: TouchEvent) => ev.touches.length === 0 && release(ev.timeStamp)
  const onTouchMove = (ev: TouchEvent) => {
    const t = ev.touches[0]
    if (t) hold.onMove?.(t.clientY)
  }
  const targets: EventTarget[] = [window, ...(target ? [target] : [])]

  function cleanup() {
    for (const t of targets) {
      t.removeEventListener('pointerup', onPointerEnd as EventListener, true)
      t.removeEventListener('pointercancel', onPointerEnd as EventListener, true)
      t.removeEventListener('pointermove', onPointerMove as EventListener, true)
      t.removeEventListener('touchend', onTouchEnd as EventListener, true)
      t.removeEventListener('touchcancel', onTouchEnd as EventListener, true)
      t.removeEventListener('touchmove', onTouchMove as EventListener, true)
    }
    try {
      if (root.hasPointerCapture(pointerId)) root.releasePointerCapture(pointerId)
    } catch {
      // egal
    }
  }

  for (const t of targets) {
    t.addEventListener('pointerup', onPointerEnd as EventListener, true)
    t.addEventListener('pointercancel', onPointerEnd as EventListener, true)
    t.addEventListener('pointermove', onPointerMove as EventListener, true)
    t.addEventListener('touchend', onTouchEnd as EventListener, true)
    t.addEventListener('touchcancel', onTouchEnd as EventListener, true)
    t.addEventListener('touchmove', onTouchMove as EventListener, { capture: true, passive: true })
  }
}

/** Vom Aufnahme-Screen beim Öffnen: übernimmt den Finger (einmalig). */
export function takeInstantHold(): InstantHold | null {
  const h = current
  current = null
  return h
}
