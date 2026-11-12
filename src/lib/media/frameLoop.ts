/**
 * Ruft cb für jeden dargestellten Videoframe mit dessen Medienzeit auf.
 * requestVideoFrameCallback ist framegenau; Fallback: rAF + currentTime.
 * cb gibt false zurück, um die Schleife zu beenden.
 */
export function onEachFrame(video: HTMLVideoElement, cb: (mediaTime: number) => boolean): () => void {
  let stopped = false
  if (hasFrameCallback(video)) {
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
