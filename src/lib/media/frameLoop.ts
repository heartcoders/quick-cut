export interface FrameLoopOptions {
  /**
   * 'auto': requestVideoFrameCallback, wenn vorhanden (framegenau), sonst rAF.
   * 'raf': immer rAF + currentTime. Nötig für Videos, die nicht direkt
   * angezeigt werden: WebKit/iOS ruft rVFC dann nicht (zuverlässig) auf.
   */
  clock?: 'auto' | 'raf'
}

/**
 * Ruft cb für jeden Frame mit der aktuellen Medienzeit auf.
 * cb gibt false zurück, um die Schleife zu beenden.
 */
export function onEachFrame(
  video: HTMLVideoElement,
  cb: (mediaTime: number) => boolean,
  { clock = 'auto' }: FrameLoopOptions = {},
): () => void {
  let stopped = false
  if (clock === 'auto' && hasFrameCallback(video)) {
    let handle = 0
    const step = (_now: number, meta: VideoFrameCallbackMetadata) => {
      if (stopped) return
      if (cb(meta.mediaTime)) handle = video.requestVideoFrameCallback(step)
      else stopped = true
    }
    handle = video.requestVideoFrameCallback(step)
    return () => {
      stopped = true
      video.cancelVideoFrameCallback(handle)
    }
  }
  let raf = 0
  const step = () => {
    if (stopped) return
    if (cb(video.currentTime)) raf = requestAnimationFrame(step)
    else stopped = true
  }
  raf = requestAnimationFrame(step)
  return () => {
    stopped = true
    cancelAnimationFrame(raf)
  }
}

/** Safari < 15.4 kennt requestVideoFrameCallback nicht (TS-Typen tun so, als ob). */
export function hasFrameCallback(video: HTMLVideoElement): boolean {
  return typeof (video as Partial<HTMLVideoElement>).requestVideoFrameCallback === 'function'
}

/** Halber Frame bei 30 fps: so weit vor dem Ende wird bereits gestoppt. */
export const END_EPSILON = 1 / 60

/**
 * Wartet, bis ein Element nach play() wirklich läuft (Zeit schreitet voran) –
 * ohne rVFC, damit es auch für nicht angezeigte Videos auf iOS funktioniert.
 * Liefert die gemessene Anlaufzeit in Sekunden.
 */
export function whenRunning(
  el: HTMLVideoElement,
  timeoutMs = 700,
  t0 = performance.now(),
  start = el.currentTime,
): Promise<number> {
  return new Promise((resolve) => {
    const check = () => {
      const elapsed = performance.now() - t0
      if (!el.paused && el.readyState >= 2 && el.currentTime > start + 0.001) return resolve(elapsed / 1000)
      if (elapsed > timeoutMs) return resolve(timeoutMs / 1000)
      requestAnimationFrame(check)
    }
    check()
  })
}

export const LEAD_MIN = 0.03
export const LEAD_MAX = 0.4
export const LEAD_INITIAL = 0.05

/**
 * Gleitender Mittelwert der Anlaufzeit → Vorlauf für den nächsten Clipstart.
 * Lieber minimal zu knapp (letzter Frame steht ~1 Frame länger) als zu früh
 * (Anfang des nächsten Clips würde unsichtbar übersprungen).
 */
export const LEAD_SAFETY = 0.85

export function nextLead(prev: number, measured: number): number {
  return Math.min(LEAD_MAX, Math.max(LEAD_MIN, prev * 0.6 + measured * 0.4))
}
