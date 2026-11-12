import * as db from '../project/db'

/**
 * Object-URLs der Video-Blobs, einmal pro Clip erzeugt und wiederverwendet.
 * Freigabe beim Löschen des Clips (store.removeClip).
 */
const cache = new Map<string, Promise<string | null>>()

export function getClipUrl(clip: { blobKey: string }): Promise<string | null> {
  let p = cache.get(clip.blobKey)
  if (!p) {
    p = db.getBlob(clip.blobKey).then((b) => (b ? URL.createObjectURL(b) : null))
    cache.set(clip.blobKey, p)
  }
  return p
}

export function releaseClipUrl(blobKey: string): void {
  const p = cache.get(blobKey)
  if (!p) return
  cache.delete(blobKey)
  void p.then((url) => url && URL.revokeObjectURL(url))
}
