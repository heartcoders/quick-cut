import { SerialQueue } from '../media/queue'
import * as db from '../project/db'
import type { FaceTrackRecord } from '../project/types'
import { analyzeFaces, AnalyzeCancelled } from './analyze'

/**
 * Gesichter je Video: Cache der Analyse-Ergebnisse aus IndexedDB und laufende
 * Analysen (eigene Warteschlange, damit Import/Thumbnails nicht warten).
 */
class FaceStore {
  /** Zählt bei jedem neuen Ergebnis hoch – Renderer-Eingaben hängen davon ab. */
  revision = $state(0)
  /** Fortschritt laufender oder wartender Analysen (0…1), Schlüssel = blobKey. */
  progress = $state<Record<string, number>>({})

  #cache = new Map<string, Promise<FaceTrackRecord | null>>()
  #jobs = new Map<string, AbortController>()
  #queue = new SerialQueue()

  get(blobKey: string): Promise<FaceTrackRecord | null> {
    let p = this.#cache.get(blobKey)
    if (!p) {
      p = db.getFaces(blobKey).then(
        (r) => r ?? null,
        () => null,
      )
      this.#cache.set(blobKey, p)
    }
    return p
  }

  running(blobKey: string): boolean {
    return blobKey in this.progress
  }

  /** Analyse einreihen (doppelte Aufträge werden ignoriert). Wirft bei Fehler, nicht bei Abbruch. */
  async analyze(blobKey: string, duration: number): Promise<FaceTrackRecord | null> {
    if (this.#jobs.has(blobKey)) return null
    const ctl = new AbortController()
    this.#jobs.set(blobKey, ctl)
    this.progress[blobKey] = 0
    try {
      return await this.#queue.enqueue(async () => {
        if (ctl.signal.aborted) throw new AnalyzeCancelled()
        const blob = await db.getBlob(blobKey)
        if (!blob) throw new Error('Clip-Datei nicht gefunden')
        const rec = await analyzeFaces(blob, duration, (p) => (this.progress[blobKey] = p), ctl.signal)
        await db.putFaces(blobKey, rec)
        this.#cache.set(blobKey, Promise.resolve(rec))
        this.revision++
        return rec
      })
    } catch (err) {
      if (err instanceof AnalyzeCancelled) return null
      throw err
    } finally {
      this.#jobs.delete(blobKey)
      delete this.progress[blobKey]
    }
  }

  cancel(blobKey: string): void {
    this.#jobs.get(blobKey)?.abort()
  }

  release(blobKey: string): void {
    this.cancel(blobKey)
    this.#cache.delete(blobKey)
  }
}

export const faceStore = new FaceStore()
