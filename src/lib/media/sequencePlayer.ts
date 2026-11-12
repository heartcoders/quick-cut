import {
  clamp,
  clipStartTimes,
  effectiveDurations,
  resolveFrame,
  type TransitionSpec,
  type TransitionType,
} from '../timeline/timeline'
import { END_EPSILON, hasFrameCallback, onEachFrame } from './frameLoop'
import { once } from './video'

export interface SeqClip {
  url: string
  trimStart: number
  trimEnd: number
  duration: number
}

/** Was gerade zu zeichnen ist. `to` nur während eines Übergangs. */
export interface FrameState {
  from: HTMLVideoElement
  to: HTMLVideoElement | null
  p: number
  fromIndex: number
  type: TransitionType
}

export interface SequenceCallbacks {
  /** Gesamtzeit in der Timeline. */
  onTime?: (t: number) => void
  /** Erster Frame ist sichtbar – ab jetzt darf gezeichnet/aufgenommen werden. */
  onReady?: () => void
  /** Pro Videoframe: welche Elemente mit welchem Fortschritt zu zeichnen sind. */
  onFrame?: (state: FrameState) => void
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
 * Echtzeit-Wiedergabe der Timeline mit zwei abwechselnden <video>-Elementen.
 * - Harter Schnitt: Das alte Element friert auf dem letzten Frame ein, bis das
 *   neue seinen ersten Frame zeigt (kein Schwarzbild).
 * - Übergang: Das vorbereitete nächste Element startet bei trimEnd − d, beide
 *   laufen parallel, `onFrame` liefert den Fortschritt p.
 * Weil ein Übergang höchstens halb so lang ist wie der kürzere Clip, überlappen
 * sich Ein- und Ausgangsübergang eines Clips nie – zwei Elemente reichen.
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
  start(clips: SeqClip[], transitions: TransitionSpec[] = [], fromTime = 0): void {
    this.stop()
    const session = ++this.#session
    if (clips.length === 0) return

    // Startpunkt bestimmen; mitten in einem Übergang → an dessen Beginn.
    const d = effectiveDurations(clips, transitions)
    let f = resolveFrame(clips, transitions, Math.max(0, fromTime))
    if (f?.to) {
      const i = f.from.index
      const tStart = clips[i]!.trimEnd - d[i]!
      f = { ...f, from: { index: i, localTime: tStart }, to: undefined }
    }
    const startIndex = f?.from.index ?? 0
    const startLocal = f?.from.localTime ?? clips[0]!.trimStart

    const [a, b] = this.#els
    const first = clips[startIndex]!
    if (a.src !== first.url) a.src = first.url
    a.currentTime = Math.min(startLocal, first.trimEnd - 0.05)
    a.muted = false

    // iOS: beide Elemente innerhalb der Geste einmal abspielen → später ohne Geste erlaubt.
    const second = clips[startIndex + 1] ?? first
    if (b.src !== second.url) b.src = second.url
    b.muted = true
    b.play()
      .then(() => b.pause())
      .catch(() => {})
      .finally(() => {
        b.muted = false
      })

    void this.#run(session, clips, transitions, d, startIndex, a.play())
  }

  async #run(
    session: number,
    clips: SeqClip[],
    transitions: TransitionSpec[],
    d: number[],
    startIndex: number,
    firstPlay: Promise<void>,
  ): Promise<void> {
    const starts = clipStartTimes(clips, transitions)
    const alive = () => session === this.#session
    let active: 0 | 1 = 0

    try {
      await firstPlay
    } catch (err) {
      console.warn('Wiedergabe blockiert', err)
      if (alive()) this.#finish()
      return
    }
    await firstFrame(this.#els[0])
    if (!alive()) return
    this.#cb.onFrame?.({ from: this.#els[0], to: null, p: 0, fromIndex: startIndex, type: 'none' })
    this.#cb.onReady?.()

    let preparing: Promise<void> | null = clips[startIndex + 1]
      ? prepare(this.#els[1], clips[startIndex + 1]!)
      : null

    for (let i = startIndex; i < clips.length; i++) {
      if (!alive()) return
      const clip = clips[i]!
      const el = this.#els[active]
      const other = this.#els[active === 0 ? 1 : 0]
      const next = clips[i + 1]
      const di = next ? (d[i] ?? 0) : 0
      const type = di > 0 ? transitions[i]!.type : 'none'
      const transitionStart = clip.trimEnd - di
      let nextStarted: Promise<void> | null = null

      const startNext = () =>
        (nextStarted ??= (async () => {
          if (preparing) await preparing
          if (!alive()) return
          await other.play()
        })().catch((err) => console.warn('Übergang: nächster Clip startet nicht', err)))

      // Bis zum Ende dieses Clips laufen lassen (inkl. Übergang).
      // Wichtig: Die Frame-Schleife muss in *jedem* Fall beendet werden – auch
      // wenn 'ended' zuerst kommt (der letzte Frame liegt oft knapp vor
      // trimEnd). Sonst läuft sie weiter, sobald das Element den übernächsten
      // Clip spielt, und meldet falsche Frames.
      await new Promise<void>((resolve) => {
        let finished = false
        const end = () => {
          if (finished) return
          finished = true
          el.removeEventListener('ended', end)
          stop()
          resolve()
        }
        el.addEventListener('ended', end)
        const stop = onEachFrame(el, (t) => {
          if (finished) return false
          if (!alive()) {
            end()
            return false
          }
          const inTransition = di > 0 && t >= transitionStart - END_EPSILON
          if (inTransition) void startNext()
          const p = inTransition ? clamp((t - transitionStart) / di, 0, 1) : 0
          this.#cb.onFrame?.({ from: el, to: inTransition ? other : null, p, fromIndex: i, type: inTransition ? type : 'none' })
          this.#cb.onTime?.(starts[i]! + Math.max(0, t - clip.trimStart))
          if (t >= clip.trimEnd - END_EPSILON) {
            end()
            return false
          }
          return true
        })
        this.#stopLoop = end
      })
      if (!alive()) return

      el.pause() // letzter Frame bleibt stehen
      if (!next) break

      if (di > 0) {
        await startNext() // läuft normalerweise schon
      } else {
        if (preparing) await preparing
        if (!alive()) return
        try {
          await other.play()
        } catch (err) {
          console.warn('Wiedergabe des nächsten Clips blockiert', err)
          break
        }
        await firstFrame(other)
      }
      if (!alive()) return
      active = active === 0 ? 1 : 0
      this.#cb.onFrame?.({ from: other, to: null, p: 0, fromIndex: i + 1, type: 'none' })

      // Das frei gewordene Element mit dem übernächsten Clip vorladen.
      const afterNext = clips[i + 2]
      preparing = afterNext ? prepare(el, afterNext) : null
    }

    if (alive()) {
      const last = clips.length - 1
      this.#cb.onTime?.(starts[last]! + (clips[last]!.trimEnd - clips[last]!.trimStart))
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
