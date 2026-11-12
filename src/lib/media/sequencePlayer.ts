import { clipStartTimes } from '../timeline/timeline'
import { END_EPSILON, hasFrameCallback, onEachFrame } from './frameLoop'
import { once } from './video'

export interface SeqClip {
  url: string
  trimStart: number
  trimEnd: number
  duration: number
}

export interface SequenceCallbacks {
  /** Gesamtzeit in der Timeline. */
  onTime?: (t: number) => void
  /**
   * Welches Element (0 = A, 1 = B) sichtbar sein soll. Erster Aufruf erst,
   * wenn A einen Frame zeigt – bis dahin bleibt die bisherige Vorschau stehen.
   */
  onSwitch?: (active: 0 | 1, clipIndex: number) => void
  onEnd?: () => void
}

/** Lädt einen Clip in ein Element und wartet, bis der Startframe darstellbar ist. */
async function prepare(el: HTMLVideoElement, clip: SeqClip): Promise<void> {
  if (el.src !== clip.url) {
    el.src = clip.url
    el.load()
  }
  if (el.readyState < 1) await once(el, ['loadedmetadata', 'error'], 5000)
  if (Math.abs(el.currentTime - clip.trimStart) > 0.01) {
    const seeked = once(el, ['seeked', 'error'], 3000)
    el.currentTime = clip.trimStart
    await seeked
  }
  if (el.readyState < 2) await once(el, ['loadeddata', 'canplay', 'error'], 3000)
}

/** Wartet, bis das Element nach play() tatsächlich einen Frame zeigt. */
function firstFrame(el: HTMLVideoElement): Promise<void> {
  return new Promise((resolve) => {
    if (hasFrameCallback(el)) el.requestVideoFrameCallback(() => resolve())
    else once(el, ['playing'], 1000).then(() => resolve())
    setTimeout(resolve, 500) // Sicherheitsnetz
  })
}

/**
 * „Alles abspielen“ mit zwei abwechselnden <video>-Elementen: Das inaktive
 * Element lädt den nächsten Clip vor und steht auf trimStart. Am Clipende
 * friert das aktive Element auf dem letzten Frame ein, bis das andere
 * seinen ersten Frame zeigt – dadurch kein Schwarzbild.
 */
export class SequencePlayer {
  #els: [HTMLVideoElement, HTMLVideoElement]
  #cb: SequenceCallbacks
  #session = 0
  #stopLoop: (() => void) | null = null

  constructor(a: HTMLVideoElement, b: HTMLVideoElement, cb: SequenceCallbacks = {}) {
    this.#els = [a, b]
    this.#cb = cb
  }

  /** Muss synchron aus einem Tap aufgerufen werden (iOS-Autoplay-Regeln). */
  start(clips: SeqClip[]): void {
    this.stop()
    const session = ++this.#session
    if (clips.length === 0) return
    const [a, b] = this.#els
    const first = clips[0]!

    // iOS: beide Elemente innerhalb der Geste einmal abspielen → später ohne Geste erlaubt.
    a.src !== first.url && (a.src = first.url)
    a.currentTime = first.trimStart
    a.muted = false
    const second = clips[1] ?? first
    if (b.src !== second.url) b.src = second.url
    b.muted = true
    b.play()
      .then(() => b.pause())
      .catch(() => {})
      .finally(() => {
        b.muted = false
      })

    void this.#run(session, clips, a.play())
  }

  async #run(session: number, clips: SeqClip[], firstPlay: Promise<void>): Promise<void> {
    const starts = clipStartTimes(clips)
    const alive = () => session === this.#session
    let active: 0 | 1 = 0

    try {
      await firstPlay
    } catch (err) {
      console.warn('Wiedergabe blockiert', err)
      if (alive()) this.#finish()
      return
    }
    // Erst sichtbar schalten, wenn A wirklich einen Frame zeigt (sonst Schwarzbild).
    await firstFrame(this.#els[0])
    if (!alive()) return
    this.#cb.onSwitch?.(0, 0)

    let preparing: Promise<void> | null = clips[1] ? prepare(this.#els[1], clips[1]) : null

    for (let i = 0; i < clips.length; i++) {
      if (!alive()) return
      const clip = clips[i]!
      const el = this.#els[active]

      // Bis zum Ende dieses Clips laufen lassen.
      await new Promise<void>((resolve) => {
        const onEnded = () => resolve()
        el.addEventListener('ended', onEnded, { once: true })
        this.#stopLoop = onEachFrame(el, (t) => {
          if (!alive()) {
            resolve()
            return false
          }
          if (t >= clip.trimEnd - END_EPSILON) {
            el.removeEventListener('ended', onEnded)
            resolve()
            return false
          }
          this.#cb.onTime?.(starts[i]! + Math.max(0, t - clip.trimStart))
          return true
        })
      })
      if (!alive()) return

      // Letzter Frame bleibt stehen, bis der nächste Clip sichtbar ist.
      el.pause()
      const next = clips[i + 1]
      if (!next) break

      const nextEl = this.#els[active === 0 ? 1 : 0]
      if (preparing) await preparing
      if (!alive()) return
      try {
        await nextEl.play()
      } catch (err) {
        console.warn('Wiedergabe des nächsten Clips blockiert', err)
        break
      }
      await firstFrame(nextEl)
      if (!alive()) return
      active = active === 0 ? 1 : 0
      this.#cb.onSwitch?.(active, i + 1)

      // Das frei gewordene Element mit dem übernächsten Clip vorladen.
      const afterNext = clips[i + 2]
      preparing = afterNext ? prepare(el, afterNext) : null
    }

    if (alive()) {
      this.#cb.onTime?.(starts.at(-1)! + (clips.at(-1)!.trimEnd - clips.at(-1)!.trimStart))
      this.#finish()
    }
  }

  #finish() {
    this.#stopLoop?.()
    this.#stopLoop = null
    this.#session++
    this.#cb.onEnd?.()
  }

  stop(): void {
    this.#session++
    this.#stopLoop?.()
    this.#stopLoop = null
    for (const el of this.#els) el.pause()
  }
}
