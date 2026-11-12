/** Minimales Interface, damit der Seeker ohne DOM testbar ist. */
export interface Seekable extends EventTarget {
  currentTime: number
}

export interface Seeker {
  /** Springt zu t. Läuft schon ein Seek, gewinnt nach dessen Ende der letzte Wunsch. */
  request(t: number): void
  dispose(): void
}

/**
 * Drosselt Seeks beim Ziehen: höchstens einer gleichzeitig, Zwischenwerte
 * werden verworfen. So bleibt die Vorschau flüssig, auch auf schwachen Geräten.
 */
export function createSeeker(video: Seekable): Seeker {
  let busy = false
  let pending: number | null = null

  const onSeeked = () => {
    busy = false
    if (pending !== null) {
      const t = pending
      pending = null
      go(t)
    }
  }
  video.addEventListener('seeked', onSeeked)

  function go(t: number) {
    busy = true
    video.currentTime = t
  }

  return {
    request(t) {
      if (busy) pending = t
      else go(t)
    },
    dispose() {
      video.removeEventListener('seeked', onSeeked)
      pending = null
    },
  }
}
