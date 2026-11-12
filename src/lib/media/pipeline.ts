import * as db from '../project/db'
import { newId } from '../project/id'
import { store } from '../project/store.svelte'
import type { Clip, ClipSource } from '../project/types'
import { makeFilmstrip } from './filmstrip'
import { probe } from './probe'
import { mediaQueue } from './queue'
import { openVideo } from './video'

export interface IngestOptions {
  /** Gemessene Aufnahmedauer, falls der Browser keine Dauer liefert. */
  fallbackDuration?: number
  mimeType?: string
}

/**
 * Gemeinsamer Ablauf für Aufnahme und Import:
 * Blob speichern → Clip als 'processing' anhängen → Metadaten und
 * Filmstreifen seriell erzeugen → Clip auf 'ready' bzw. 'error' setzen.
 */
export async function ingestBlob(blob: Blob, source: ClipSource, opts: IngestOptions = {}): Promise<Clip> {
  const id = newId()
  const blobKey = `blob-${id}`
  await db.putBlob(blobKey, blob)
  const clip = store.addClip(
    {
      id,
      blobKey,
      mimeType: opts.mimeType || blob.type || 'video/mp4',
      duration: 0,
      width: 0,
      height: 0,
      rotation: 0,
      trimStart: 0,
      trimEnd: 0,
      source,
      thumbKeys: [],
      playable: true,
    },
    'processing',
  )
  void mediaQueue.enqueue(() => processClip(id, blob, opts.fallbackDuration))
  return clip
}

/** Setzt nach einem Reload unterbrochene Verarbeitungen fort. */
export function resumePendingClips(): void {
  for (const clip of store.project.clips) {
    if (clip.status !== 'processing') continue
    const { id, blobKey } = clip
    void mediaQueue.enqueue(async () => {
      const blob = await db.getBlob(blobKey)
      if (!blob) {
        store.updateClip(id, { status: 'error', playable: false })
        return
      }
      await processClip(id, blob)
    })
  }
}

async function processClip(id: string, blob: Blob, fallbackDuration?: number): Promise<void> {
  if (!store.getClip(id)) return // inzwischen gelöscht
  const { loaded, ok } = await openVideo(blob)
  try {
    if (!ok) {
      store.updateClip(id, { status: 'error', playable: false })
      return
    }
    const meta = await probe(loaded.video, fallbackDuration)
    if (!meta.playable) {
      store.updateClip(id, { ...meta, trimEnd: meta.duration, status: 'error' })
      return
    }

    const frames = await makeFilmstrip(loaded.video, meta.duration)
    const thumbKeys: string[] = []
    for (const [i, frame] of frames.entries()) {
      const key = `thumb-${id}-${i}`
      await db.putThumb(key, frame)
      thumbKeys.push(key)
    }

    // Clip wurde während der Verarbeitung gelöscht → Thumbnails wieder entfernen.
    if (!store.getClip(id)) {
      await db.deleteClipData(`blob-${id}`, thumbKeys)
      return
    }
    store.updateClip(id, {
      ...meta,
      trimStart: 0,
      trimEnd: meta.duration,
      thumbKeys,
      thumbnails: frames.map((f) => URL.createObjectURL(f)),
      status: 'ready',
    })
  } catch (err) {
    console.error('Clip-Verarbeitung fehlgeschlagen', err)
    store.updateClip(id, { status: 'error' })
  } finally {
    loaded.dispose()
  }
}
