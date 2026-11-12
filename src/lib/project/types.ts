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
  /** Filter und Effekte. Fehlt bei alten Projekten (= DEFAULT_LOOK). */
  look?: ClipLook
  /** Lautstärke des Clip-Tons 0…1 (0 = stumm). Fehlt = 1. */
  volume?: number
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

export type FilterId = 'none' | 'warm' | 'cool' | 'vivid' | 'fade' | 'retro' | 'mono' | 'noir'

/** Look eines Clips: Farbfilter plus Effekte, alle Stärken 0…1 (0 = aus). */
export interface ClipLook {
  filter: FilterId
  /** Stärke des Filters */
  amount: number
  grain: number
  vignette: number
  vhs: number
  glitch: number
}

export const DEFAULT_LOOK: ClipLook = { filter: 'none', amount: 1, grain: 0, vignette: 0, vhs: 0, glitch: 0 }

export interface Transition {
  type: 'none' | 'crossfade' | 'slide' | 'wipe'
  duration: number // Sekunden
}

/** Hintergrundmusik aus einer eigenen Audiodatei. */
export interface MusicTrack {
  blobKey: string
  name: string
  /** Länge des Songs in Sekunden */
  duration: number
  /** Startpunkt im Song (s) */
  offset: number
  volume: number
  /** letzte Sekunden ausblenden */
  fadeOut: boolean
  /** leiser, solange das Voiceover spricht */
  duck: boolean
}

/** Eine Voiceover-Spur fürs ganze Video. */
export interface VoiceoverTrack {
  blobKey: string
  mimeType: string
  /** Länge der Aufnahme in Sekunden */
  duration: number
  /** Timeline-Sekunde, ab der die Aufnahme klingt */
  start: number
  /** Sekunden am Anfang der Aufnahme überspringen (Vorlauf vor dem ersten Bild) */
  skip: number
  volume: number
}

export interface ProjectRecord {
  id: string
  /** Eigener Name; fehlt → Datum wird angezeigt. */
  name?: string
  /** ms seit Epoch. Fehlt bei Projekten von vor dem Startscreen. */
  createdAt?: number
  updatedAt?: number
  clips: ClipRecord[]
  transitions: Transition[] // Länge = clips.length - 1
  outputAspect: AspectRatio
  music?: MusicTrack
  voiceover?: VoiceoverTrack
}

export interface Project extends Omit<ProjectRecord, 'clips'> {
  clips: Clip[]
}

export const NO_TRANSITION: Transition = { type: 'none', duration: 0 }
