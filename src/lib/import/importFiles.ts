import { toasts } from '../../ui/toast.svelte'
import { MAX_CLIP_SECONDS, MAX_EDGE_PX, MAX_PROJECT_SECONDS } from '../limits'
import { ingestBlob, type ProcessResult } from '../media/pipeline'
import { store } from '../project/store.svelte'

export const UNPLAYABLE_HINT =
  'Dieses Video kann der Browser nicht abspielen (z. B. HEVC/H.265). ' +
  'Tipp fürs iPhone: Einstellungen › Kamera › Formate › „Maximale Kompatibilität“.'

const EXT_MIME: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  qt: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  '3gp': 'video/3gpp',
}

/** MIME-Typ einer Datei; manche Android-Galerien liefern einen leeren `type`. */
export function mimeFromFile(file: { name: string; type: string }): string {
  if (file.type) return file.type
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  return EXT_MIME[ext] ?? 'video/mp4'
}

export function clipWarnings(meta: Pick<ProcessResult, 'duration' | 'width' | 'height'>): string[] {
  const out: string[] = []
  if (meta.duration > MAX_CLIP_SECONDS) {
    out.push(`Clip ist länger als ${MAX_CLIP_SECONDS / 60} min – das kann auf schwachen Geräten instabil werden.`)
  }
  if (Math.max(meta.width, meta.height) > MAX_EDGE_PX) {
    out.push('Clip ist größer als 4K – das kann den Browser-Tab zum Absturz bringen.')
  }
  return out
}

/**
 * Importiert Dateien aus der Galerie nacheinander. Die Datei selbst (ein Blob)
 * wandert direkt in IndexedDB, ohne sie vorher komplett in den RAM zu lesen.
 */
export async function importFiles(files: Iterable<File>): Promise<void> {
  const pending: Promise<ProcessResult>[] = []
  for (const file of files) {
    if (file.type && !file.type.startsWith('video/')) {
      toasts.show(`„${file.name}“ ist kein Video.`, 'warn')
      continue
    }
    try {
      const { done } = await ingestBlob(file, 'imported', { mimeType: mimeFromFile(file) })
      pending.push(done)
    } catch (err) {
      console.error('Import fehlgeschlagen', err)
      toasts.show(`„${file.name}“ konnte nicht gespeichert werden (Speicher voll?).`, 'error')
    }
  }

  for (const done of pending) {
    void done.then((r) => {
      if (r.status === 'error') toasts.show(UNPLAYABLE_HINT, 'error', 7000)
      else if (r.status === 'ready') clipWarnings(r).forEach((w) => toasts.show(w, 'warn'))
    })
  }

  await Promise.allSettled(pending)
  if (store.totalDuration > MAX_PROJECT_SECONDS) {
    toasts.show(`Projekt ist länger als ${MAX_PROJECT_SECONDS / 60} min – der Export kann lange dauern.`, 'warn')
  }
}
