import * as db from '../project/db'

/**
 * Dekodierter Ton je Clip (AudioBuffer sind nicht an einen Kontext gebunden).
 * Hintergrund: iOS lässt nur EIN unstummes <video> gleichzeitig spielen. Für
 * Übergänge und den Vorlauf beim harten Schnitt laufen aber zwei Videos
 * parallel – die sind deshalb stumm, der Ton kommt aus diesen Puffern.
 */
const cache = new Map<string, Promise<AudioBuffer | null>>()
let decoder: OfflineAudioContext | null = null
let queue: Promise<unknown> = Promise.resolve()

const SAMPLE_RATE = 48_000

/** Nacheinander dekodieren – parallel würde auf dem Handy viel Speicher brauchen. */
function decode(blobKey: string): Promise<AudioBuffer | null> {
  const job = queue.then(async () => {
    const blob = await db.getBlob(blobKey)
    if (!blob) return null
    decoder ??= new OfflineAudioContext(2, 1, SAMPLE_RATE)
    try {
      return await decoder.decodeAudioData(await blob.arrayBuffer())
    } catch {
      return null // keine (dekodierbare) Tonspur
    }
  })
  queue = job.catch(() => null)
  return job
}

export function getClipAudio(blobKey: string | undefined): Promise<AudioBuffer | null> {
  if (!blobKey || typeof OfflineAudioContext === 'undefined') return Promise.resolve(null)
  let p = cache.get(blobKey)
  if (!p) {
    p = decode(blobKey)
    cache.set(blobKey, p)
  }
  return p
}

export function releaseClipAudio(blobKey: string): void {
  cache.delete(blobKey)
}
