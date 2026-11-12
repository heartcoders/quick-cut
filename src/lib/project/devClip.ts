import * as db from './db'
import { newId } from './id'
import type { ClipRecord } from './types'

/**
 * Nur DEV: legt einen synthetischen Clip mit farbigem Thumbnail an,
 * um die Persistenz (Phase-1-Abnahme) ohne Kamera zu prüfen.
 */
export async function createDevClip(): Promise<{ record: ClipRecord; thumbUrl: string }> {
  const id = newId()
  const blobKey = `blob-${id}`
  const thumbKey = `thumb-${id}-0`

  await db.putBlob(blobKey, new Blob([new Uint8Array(1024)], { type: 'video/mp4' }))

  const canvas = document.createElement('canvas')
  canvas.width = 45
  canvas.height = 80
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = `hsl(${Math.floor(Math.random() * 360)} 70% 50%)`
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  const thumb = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/jpeg', 0.8),
  )
  await db.putThumb(thumbKey, thumb)

  const duration = Math.round((2 + Math.random() * 6) * 10) / 10
  return {
    record: {
      id,
      blobKey,
      mimeType: 'video/mp4',
      duration,
      width: 1080,
      height: 1920,
      rotation: 0,
      trimStart: 0,
      trimEnd: duration,
      source: 'recorded',
      thumbKeys: [thumbKey],
      playable: true,
    },
    thumbUrl: URL.createObjectURL(thumb),
  }
}
