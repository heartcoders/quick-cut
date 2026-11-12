import {
  clamp,
  clipStartTimes,
  effectiveDurations,
  resolveFrame,
  type TransitionSpec,
  type TransitionType,
} from '../timeline/timeline'
import { END_EPSILON, LEAD_INITIAL, LEAD_SAFETY, nextLead, onEachFrame, whenRunning } from './frameLoop'
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

/**
 * Echtzeit-Wiedergabe der Timeline mit zwei abwechselnden <video>-Elementen.
 * - Harter Schnitt: Das alte Element friert auf dem letzten Frame ein, bis das
 *   neue seinen ersten Frame zeigt (kein Schwarzbild).
 * - Übergang: Das vorbereitete nächste Element startet bei trimEnd − d, beide
 *   laufen parallel, `onFrame` liefert den Fortschritt p.
 * Weil ein Übergang höchstens halb so lang ist wie der kürzere Clip, überlappen
 * sich Ein- und Ausgangsübergang eines Clips nie – zwei Elemente reichen.
 *
 * iOS: Die Zeitbasis ist rAF + currentTime (nicht rVFC), weil WebKit rVFC für
 * nicht direkt angezeigte Videos nicht zuverlässig aufruft. Der nächste Clip
 * wird um die gemessene Anlaufzeit (`lead`) früher gestartet, damit der harte
 * Schnitt ohne Stocken passiert – während des Anlaufens steht seine Zeit still,
 * es geht also kaum Inhalt verloren.
 */
export class SequencePlayer {
  /** Gemessener Vorlauf in Sekunden, über Instanzen hinweg gelernt. */
  static lead = LEAD_INITIAL

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
    // Beide Videos immer stumm: iOS lässt nur EIN unstummes Video gleichzeitig
    // spielen und pausiert sonst das andere. Der Ton kommt separat (clipAudio).
    // Stumme Videos dürfen auf iOS zudem ohne Tap-Geste starten.
    a.muted = true
    b.muted = true
    if (a.src !== first.url) a.src = first.url
    a.currentTime = Math.min(startLocal, first.trimEnd - 0.05)
    const second = clips[startIndex + 1]
    if (second && b.src !== second.url) b.src = second.url

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
    await whenRunning(this.#els[0])
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
      let nextRunning = false

      const startNext = () =>
        (nextStarted ??= (async () => {
          if (preparing) await preparing
          if (!alive()) return
          // Anlaufzeit = vom play()-Aufruf bis die Zeit tatsächlich voranschreitet.
          const t0 = performance.now()
          const startTime = other.currentTime
          await other.play()
          const latency = await whenRunning(other, 700, t0, startTime)
          SequencePlayer.lead = nextLead(SequencePlayer.lead, latency)
          nextRunning = true
        })().catch((err) => console.warn('Nächster Clip startet nicht', err)))

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
        const stop = onEachFrame(
          el,
          (t) => {
            if (finished) return false
            if (!alive()) {
              end()
              return false
            }
            const inTransition = di > 0 && t >= transitionStart - END_EPSILON
            // Vorlauf: nächsten Clip so früh starten, dass er beim Schnitt bzw.
            // Übergangsbeginn bereits läuft.
            if (next && t >= transitionStart - SequencePlayer.lead * LEAD_SAFETY) void startNext()
            const p = inTransition ? clamp((t - transitionStart) / di, 0, 1) : 0
            this.#cb.onFrame?.({
              from: el,
              to: inTransition ? other : null,
              p,
              fromIndex: i,
              type: inTransition ? type : 'none',
            })
            this.#cb.onTime?.(starts[i]! + Math.max(0, t - clip.trimStart))
            if (t >= clip.trimEnd - END_EPSILON) {
              end()
              return false
            }
            return true
          },
          { clock: 'raf' },
        )
        this.#stopLoop = end
      })
      if (!alive()) return

      if (!next) {
        el.pause()
        break
      }
      // Harter Schnitt: Läuft der nächste Clip schon (Vorlauf), sofort umschalten.
      // Sonst bleibt der letzte Frame stehen, bis er anläuft – nie Schwarzbild.
      if (!nextRunning) {
        el.pause()
        await startNext()
      }
      el.pause()
      if (!nextRunning && alive()) {
        console.warn('Nächster Clip läuft nicht – Wiedergabe endet')
        break
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
