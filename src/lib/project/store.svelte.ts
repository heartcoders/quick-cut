import { releaseClipAudio } from '../media/clipAudio'
import { releaseClipUrl } from '../media/clipUrls'
import { arrayMove } from '../timeline/reorder'
import { maxTransition, totalDuration } from '../timeline/timeline'
import * as db from './db'
import { newId } from './id'
import {
  NO_TRANSITION,
  type AspectRatio,
  type Clip,
  type ClipRecord,
  type ClipStatus,
  type Project,
  type ProjectRecord,
  type Transition,
} from './types'

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
