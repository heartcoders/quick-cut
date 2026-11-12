/** Hilfen rund um ein verstecktes <video> zum Auslesen eines Blobs. */

export interface LoadedVideo {
  video: HTMLVideoElement
  dispose(): void
}

export function once(
  target: EventTarget,
  events: string[],
  timeoutMs: number,
): Promise<string | 'timeout'> {
  return new Promise((resolve) => {
    const handlers = events.map((name) => {
      const h = () => finish(name)
      target.addEventListener(name, h)
      return [name, h] as const
    })
    const timer = setTimeout(() => finish('timeout'), timeoutMs)
    function finish(result: string) {
      clearTimeout(timer)
      for (const [name, h] of handlers) target.removeEventListener(name, h)
      resolve(result)
    }
  })
}

/** Lädt einen Blob in ein verstecktes Video und wartet auf die Metadaten. */
export async function openVideo(
  blob: Blob,
  timeoutMs = 10_000,
): Promise<{ loaded: LoadedVideo; ok: boolean }> {
  const url = URL.createObjectURL(blob)
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.setAttribute('playsinline', '')
  video.preload = 'auto' // iOS lädt mit 'metadata' teils keine Frames für Thumbnails
  const dispose = () => {
    video.removeAttribute('src')
    video.load()
    URL.revokeObjectURL(url)
  }
  const ready = once(video, ['loadedmetadata', 'error'], timeoutMs)
  video.src = url
  video.load()
  const result = await ready
  return { loaded: { video, dispose }, ok: result === 'loadedmetadata' }
}

/** Setzt currentTime und wartet, bis der Frame wirklich darstellbar ist. */
export async function seekTo(video: HTMLVideoElement, t: number, timeoutMs = 3000): Promise<boolean> {
  if (Math.abs(video.currentTime - t) < 0.001 && video.readyState >= 2) return true
  const seeked = once(video, ['seeked', 'error'], timeoutMs)
  video.currentTime = t
  const r = await seeked
  if (r !== 'seeked') return false
  // Safari/Chrome: Frame ist nach 'seeked' nicht immer schon dekodiert.
  if (video.readyState < 2) await once(video, ['loadeddata', 'canplay'], 1000)
  if ('requestVideoFrameCallback' in video) {
    await Promise.race([
      new Promise<void>((res) => video.requestVideoFrameCallback(() => res())),
      new Promise<void>((res) => setTimeout(res, 150)),
    ])
  }
  return true
}
