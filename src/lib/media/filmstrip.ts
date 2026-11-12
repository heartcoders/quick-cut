import { seekTo } from './video'

export interface FilmstripOptions {
  count?: number
  height?: number
  quality?: number
}

/** Zeitpunkte gleichmäßig verteilt, jeweils in der Mitte eines Segments. */
export function filmstripTimes(duration: number, count: number): number[] {
  const last = Math.max(0, duration - 0.05)
  return Array.from({ length: count }, (_, i) => Math.min(last, (duration * (i + 0.5)) / count))
}

/**
 * Erzeugt den Filmstreifen nacheinander (nicht parallel), damit die UI
 * auf schwachen Geräten flüssig bleibt. Das erste Bild dient als Thumbnail.
 */
export async function makeFilmstrip(
  video: HTMLVideoElement,
  duration: number,
  { count = 10, height = 80, quality = 0.7 }: FilmstripOptions = {},
): Promise<Blob[]> {
  const vw = video.videoWidth
  const vh = video.videoHeight
  if (!vw || !vh) return []
  const canvas = document.createElement('canvas')
  canvas.height = height
  canvas.width = Math.max(1, Math.round((vw / vh) * height))
  const ctx = canvas.getContext('2d')
  if (!ctx) return []

  const blobs: Blob[] = []
  for (const t of filmstripTimes(duration, count)) {
    if (!(await seekTo(video, t))) continue
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', quality))
    if (blob) blobs.push(blob)
    // Dem Main-Thread zwischen den Frames Luft lassen.
    await new Promise((r) => setTimeout(r, 0))
  }
  return blobs
}
