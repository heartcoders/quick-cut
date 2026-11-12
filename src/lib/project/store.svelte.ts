import { getClipAudio, releaseClipAudio } from '../media/clipAudio'
import { releaseClipUrl } from '../media/clipUrls'
import { normalizeLook } from '../renderer/looks'
import { arrayMove } from '../timeline/reorder'
import { maxTransition, totalDuration } from '../timeline/timeline'
import * as db from './db'
import { newId } from './id'
import {
  NO_TRANSITION,
  type AspectRatio,
  type Clip,
  type ClipLook,
  type ClipRecord,
  type ClipStatus,
  type MusicTrack,
  type Project,
  type ProjectRecord,
  type Transition,
  type VoiceoverTrack,
} from './types'

/** Größte Musikdatei (MB) – sie wird komplett dekodiert und im Speicher gehalten. */
export const MAX_MUSIC_MB = 30

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0)

/** Standarddauer beim Aktivieren eines Übergangs. */
export const DEFAULT_TRANSITION_SECONDS = 0.5

const SAVE_DEBOUNCE_MS = 300

function emptyProject(): Project {
  return { id: newId(), clips: [], transitions: [], outputAspect: '9:16' }
}

function toRecord(project: Project): ProjectRecord {
  const snap = $state.snapshot(project) as Project
  return {
    ...snap,
    clips: snap.clips.map(({ thumbnails: _t, status: _s, ...rec }) => rec),
  }
}

/** Hält genau `clips.length - 1` Übergänge (Phase 6 nutzt sie, bis dahin 'none'). */
function syncTransitions(project: Project): void {
  const want = Math.max(0, project.clips.length - 1)
  while (project.transitions.length < want) project.transitions.push({ ...NO_TRANSITION })
  project.transitions.length = want
}

class ProjectStore {
  project = $state<Project>(emptyProject())
  loaded = $state(false)

  /** Clips, die in Cut und Export auftauchen: fertig verarbeitet und abspielbar. */
  playableClips = $derived(this.project.clips.filter((c) => c.playable && c.status === 'ready'))

  /**
   * Übergänge zwischen aufeinanderfolgenden abspielbaren Clips. Gilt jeweils
   * der Übergang *nach* dem vorderen Clip (nicht abspielbare Clips dazwischen
   * werden übersprungen).
   */
  playableTransitions = $derived.by(() => {
    const out: Transition[] = []
    const play = this.playableClips
    for (let i = 0; i < play.length - 1; i++) {
      const idx = this.project.clips.indexOf(play[i]!)
      out.push(this.project.transitions[idx] ?? { ...NO_TRANSITION })
    }
    return out
  })

  /** Summe der getrimmten Längen minus Übergänge (Formel aus dem Handover). */
  totalDuration = $derived(totalDuration(this.playableClips, this.playableTransitions))

  hasClips = $derived(this.project.clips.length > 0)
  hasPlayableClips = $derived(this.playableClips.length > 0)

  #saveTimer: ReturnType<typeof setTimeout> | null = null
  #savePending: Promise<void> = Promise.resolve()

  /** Lädt das gespeicherte Projekt und erzeugt die Thumbnail-URLs neu. */
  async load(): Promise<void> {
    const rec = await db.loadProject()
    if (rec) {
      const clips: Clip[] = []
      for (const c of rec.clips) {
        const thumbnails: string[] = []
        for (const key of c.thumbKeys) {
          const blob = await db.getThumb(key)
          if (blob) thumbnails.push(URL.createObjectURL(blob))
        }
        // duration 0 heißt: Verarbeitung lief beim Reload noch → fortsetzen
        // (resumePendingClips in media/pipeline.ts).
        const status: ClipStatus = !c.playable ? 'error' : c.duration > 0 ? 'ready' : 'processing'
        clips.push({ ...c, thumbnails, status })
      }
      this.project = { ...rec, clips }
      syncTransitions(this.project)
    }
    this.loaded = true
  }

  getClip(id: string): Clip | undefined {
    return this.project.clips.find((c) => c.id === id)
  }

  addClip(record: ClipRecord, status: ClipStatus = 'ready', thumbnails: string[] = []): Clip {
    this.project.clips.push({ ...record, thumbnails, status })
    syncTransitions(this.project)
    this.scheduleSave()
    // Proxy aus dem State zurückgeben, damit spätere Änderungen reaktiv sind.
    return this.project.clips[this.project.clips.length - 1]!
  }

  updateClip(id: string, patch: Partial<Omit<Clip, 'id'>>): void {
    const clip = this.getClip(id)
    if (!clip) return
    if (patch.thumbnails) revokeAll(clip.thumbnails.filter((u) => !patch.thumbnails!.includes(u)))
    Object.assign(clip, patch)
    this.scheduleSave()
  }

  /**
   * Reihenfolge ändern. Übergänge bleiben an ihrer Position (Übergang 1→2
   * bleibt zwischen Platz 1 und 2) und werden über die Timeline automatisch
   * auf die neuen Nachbarn begrenzt.
   */
  moveClip(from: number, to: number): void {
    if (from === to) return
    this.project.clips = arrayMove(this.project.clips, from, to)
    this.scheduleSave()
  }

  setTrim(id: string, trimStart: number, trimEnd: number): void {
    this.updateClip(id, { trimStart, trimEnd })
  }

  /** Ausschnitt verschieben (0…1, 0.5 = mittig). */
  setPan(id: string, panX: number, panY: number): void {
    const clamp = (v: number) => Math.min(1, Math.max(0, v))
    this.updateClip(id, { panX: clamp(panX), panY: clamp(panY) })
  }

  /** Look ändern (Filter, Stärke, Effekte); Werte werden auf 0…1 geklemmt. */
  setLook(id: string, patch: Partial<ClipLook>): void {
    const clip = this.getClip(id)
    if (!clip) return
    this.updateClip(id, { look: normalizeLook({ ...clip.look, ...patch }) })
  }

  /** „Auf alle Clips anwenden“: Look des Clips `id` auf alle übertragen. */
  applyLookToAll(id: string): void {
    const look = normalizeLook(this.getClip(id)?.look)
    for (const c of this.project.clips) c.look = { ...look }
    this.scheduleSave()
  }

  /** Lautstärke des Clip-Tons (0…1, 0 = stumm). */
  setVolume(id: string, volume: number): void {
    this.updateClip(id, { volume: clamp01(volume) })
  }

  setVolumeAll(volume: number): void {
    for (const c of this.project.clips) c.volume = clamp01(volume)
    this.scheduleSave()
  }

  /**
   * Hintergrundmusik aus einer Datei setzen (ersetzt vorhandene Musik).
   * Wirft einen Fehler mit deutscher Meldung, wenn die Datei nicht passt.
   */
  async setMusic(file: File): Promise<void> {
    if (file.size > MAX_MUSIC_MB * 1024 * 1024) throw new Error(`Die Datei ist zu groß (max. ${MAX_MUSIC_MB} MB).`)
    const blobKey = `music-${newId()}`
    await db.putBlob(blobKey, file)
    const buffer = await getClipAudio(blobKey)
    if (!buffer) {
      releaseClipAudio(blobKey)
      await db.deleteBlob(blobKey)
      throw new Error('Diese Audiodatei kann der Browser nicht abspielen.')
    }
    const old = this.project.music
    this.project.music = {
      blobKey,
      name: file.name.replace(/\.[^.]+$/, '') || 'Musik',
      duration: buffer.duration,
      offset: 0,
      volume: old?.volume ?? 0.6,
      fadeOut: old?.fadeOut ?? true,
      duck: old?.duck ?? true,
    }
    this.scheduleSave()
    if (old) await this.#dropBlob(old.blobKey)
  }

  /** Größter sinnvoller Startpunkt im Song (Rest reicht noch fürs Video). */
  maxMusicOffset = $derived(Math.max(0, (this.project.music?.duration ?? 0) - this.totalDuration))

  updateMusic(patch: Partial<Pick<MusicTrack, 'offset' | 'volume' | 'fadeOut' | 'duck'>>): void {
    const m = this.project.music
    if (!m) return
    if (patch.volume !== undefined) m.volume = clamp01(patch.volume)
    if (patch.offset !== undefined) m.offset = Math.min(this.maxMusicOffset, Math.max(0, patch.offset || 0))
    if (patch.fadeOut !== undefined) m.fadeOut = patch.fadeOut
    if (patch.duck !== undefined) m.duck = patch.duck
    this.scheduleSave()
  }

  async removeMusic(): Promise<void> {
    const m = this.project.music
    if (!m) return
    this.project.music = undefined
    this.scheduleSave()
    await this.#dropBlob(m.blobKey)
  }

  /** Neue Voiceover-Aufnahme speichern (ersetzt die alte). */
  async setVoiceover(
    blob: Blob,
    meta: Pick<VoiceoverTrack, 'start' | 'skip'> & { mimeType?: string },
  ): Promise<void> {
    const blobKey = `vo-${newId()}`
    await db.putBlob(blobKey, blob)
    const buffer = await getClipAudio(blobKey)
    if (!buffer) {
      releaseClipAudio(blobKey)
      await db.deleteBlob(blobKey)
      throw new Error('Die Aufnahme konnte nicht gelesen werden.')
    }
    const old = this.project.voiceover
    this.project.voiceover = {
      blobKey,
      mimeType: meta.mimeType || blob.type || 'audio/mp4',
      duration: buffer.duration,
      start: Math.max(0, meta.start),
      skip: Math.min(buffer.duration, Math.max(0, meta.skip)),
      volume: old?.volume ?? 1,
    }
    this.scheduleSave()
    if (old) await this.#dropBlob(old.blobKey)
  }

  updateVoiceover(patch: Partial<Pick<VoiceoverTrack, 'volume'>>): void {
    const v = this.project.voiceover
    if (!v) return
    if (patch.volume !== undefined) v.volume = clamp01(patch.volume)
    this.scheduleSave()
  }

  async removeVoiceover(): Promise<void> {
    const v = this.project.voiceover
    if (!v) return
    this.project.voiceover = undefined
    this.scheduleSave()
    await this.#dropBlob(v.blobKey)
  }

  async #dropBlob(blobKey: string): Promise<void> {
    releaseClipAudio(blobKey)
    await db.deleteBlob(blobKey)
  }

  /**
   * Größtmögliche Dauer für den Übergang nach Clip `index` (Projekt-Index):
   * bezogen auf den nächsten *abspielbaren* Clip. 0, wenn es keinen gibt.
   */
  maxTransitionAt(index: number): number {
    const a = this.project.clips[index]
    if (!a || !this.playableClips.includes(a)) return 0
    const b = this.project.clips.slice(index + 1).find((c) => this.playableClips.includes(c))
    return b ? maxTransition(a, b) : 0
  }

  setTransition(index: number, patch: Partial<Transition>): void {
    const tr = this.project.transitions[index]
    if (!tr) return
    const next = { ...tr, ...patch }
    if (next.type !== 'none' && next.duration <= 0) next.duration = DEFAULT_TRANSITION_SECONDS
    const max = this.maxTransitionAt(index)
    next.duration = Math.round(Math.min(next.duration, max) * 100) / 100
    Object.assign(tr, next)
    this.scheduleSave()
  }

  /** „Für alle übernehmen“: gleicher Typ und gleiche Wunschdauer, je Paar begrenzt. */
  setAllTransitions(t: Transition): void {
    for (let i = 0; i < this.project.transitions.length; i++) this.setTransition(i, t)
  }

  setAspect(aspect: AspectRatio): void {
    this.project.outputAspect = aspect
    this.scheduleSave()
  }

  async removeClip(id: string): Promise<void> {
    const idx = this.project.clips.findIndex((c) => c.id === id)
    if (idx < 0) return
    const [clip] = this.project.clips.splice(idx, 1)
    // Den Übergang *nach* dem Clip entfernen (beim letzten Clip den davor).
    if (this.project.transitions.length > 0) {
      this.project.transitions.splice(Math.min(idx, this.project.transitions.length - 1), 1)
    }
    syncTransitions(this.project)
    revokeAll(clip!.thumbnails)
    releaseClipUrl(clip!.blobKey)
    releaseClipAudio(clip!.blobKey)
    this.scheduleSave()
    await db.deleteClipData(clip!.blobKey, clip!.thumbKeys)
  }

  scheduleSave(): void {
    if (this.#saveTimer) clearTimeout(this.#saveTimer)
    this.#saveTimer = setTimeout(() => void this.flush(), SAVE_DEBOUNCE_MS)
  }

  /** Speichert sofort (z. B. bei pagehide oder in Tests). */
  async flush(): Promise<void> {
    if (this.#saveTimer) {
      clearTimeout(this.#saveTimer)
      this.#saveTimer = null
    }
    const rec = toRecord(this.project)
    this.#savePending = this.#savePending.then(() => db.saveProject(rec))
    await this.#savePending
  }

  /** Nur für Tests. */
  _reset(): void {
    if (this.#saveTimer) clearTimeout(this.#saveTimer)
    this.#saveTimer = null
    for (const c of this.project.clips) revokeAll(c.thumbnails)
    this.project = emptyProject()
    this.loaded = false
  }
}

function revokeAll(urls: string[]): void {
  for (const u of urls) URL.revokeObjectURL(u)
}

export const store = new ProjectStore()
