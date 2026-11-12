export type ClipSource = 'recorded' | 'imported'
export type AspectRatio = '9:16' | '16:9' | '1:1'
export type ClipStatus = 'processing' | 'ready' | 'error'

/** Persistierter Teil eines Clips (liegt in IndexedDB, keine Object-URLs). */
export interface ClipRecord {
  id: string
  blobKey: string // Schlüssel im Store 'blobs'
  mimeType: string // z. B. video/mp4, video/webm
  duration: number // Sekunden, Originallänge
  width: number
  height: number
  rotation: number // Grad, 0 | 90 | 180 | 270
  /** Ausschnitt-Position im Zielformat, 0…1 (0.5 = mittig). Fehlt bei alten Projekten. */
  panX?: number
  panY?: number
  trimStart: number // Sekunden, >= 0
  trimEnd: number // Sekunden, <= duration
  source: ClipSource
  thumbKeys: string[] // Schlüssel im Store 'thumbs'
  playable: boolean // false → Hinweis statt stillem Fehler
}

/** Laufzeit-Clip: ergänzt Object-URLs und Verarbeitungsstatus. */
export interface Clip extends ClipRecord {
  thumbnails: string[] // Object-URLs des Filmstreifens
  status: ClipStatus
}

export interface Transition {
  type: 'none' | 'crossfade' | 'slide' | 'wipe'
  duration: number // Sekunden
}

export interface ProjectRecord {
  id: string
  clips: ClipRecord[]
  transitions: Transition[] // Länge = clips.length - 1
  outputAspect: AspectRatio
}

export interface Project extends Omit<ProjectRecord, 'clips'> {
  clips: Clip[]
}

export const NO_TRANSITION: Transition = { type: 'none', duration: 0 }
