import { END_EPSILON, onEachFrame } from './frameLoop'

export interface RangeCallbacks {
  onTime?: (t: number) => void
  onEnd?: () => void
}

/**
 * Spielt [from, end] eines Videos und stoppt framegenau am Endpunkt.
 * Gibt eine Stop-Funktion zurück. Muss aus einem Tap heraus aufgerufen werden (iOS).
 */
export function playRange(
  video: HTMLVideoElement,
  from: number,
  end: number,
  { onTime, onEnd }: RangeCallbacks = {},
): () => void {
  let done = false
  if (Math.abs(video.currentTime - from) > 0.01) video.currentTime = from

  const finish = () => {
    if (done) return
    done = true
    stopLoop()
    video.pause()
    video.currentTime = end
    onTime?.(end)
    onEnd?.()
  }

  const stopLoop = onEachFrame(video, (t) => {
    if (done) return false
    if (t >= end - END_EPSILON) {
      finish()
      return false
    }
    onTime?.(t)
    return true
  })

  // Natürliches Ende der Datei (trimEnd == duration) ohne letzten Frame-Callback.
  const onEnded = () => finish()
  video.addEventListener('ended', onEnded, { once: true })

  video.play().catch((err) => {
    console.warn('Wiedergabe blockiert', err)
    if (!done) {
      done = true
      stopLoop()
      onEnd?.()
    }
  })

  return () => {
    if (done) return
    done = true
    stopLoop()
    video.removeEventListener('ended', onEnded)
    video.pause()
  }
}
