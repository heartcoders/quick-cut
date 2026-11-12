/**
 * Ausgang für den Projekt-Ton: `input` → Lautsprecher (Vorschau) und
 * MediaStream (Export v1). Der Ton selbst wird aus dekodierten Puffern
 * geplant (scheduleTimelineAudio), nicht aus den <video>-Elementen.
 */
export class AudioGraph {
  readonly ctx: AudioContext
  readonly stream: MediaStream
  /** Hier werden die Clip-Quellen angeschlossen. */
  readonly input: GainNode
  #speakers: GainNode

  /** Erzeugt den Graph oder liefert null (dann ohne Ton). Im Tap aufrufen. */
  static tryCreate(): AudioGraph | null {
    try {
      return new AudioGraph()
    } catch (err) {
      console.warn('Web Audio nicht verfügbar', err)
      return null
    }
  }

  /** Im Tap erzeugen – iOS startet den Context sonst im Zustand „suspended“. */
  constructor() {
    this.ctx = new AudioContext()
    const dest = this.ctx.createMediaStreamDestination()
    this.stream = dest.stream
    this.input = this.ctx.createGain()
    this.#speakers = this.ctx.createGain()
    this.input.connect(dest)
    this.input.connect(this.#speakers)
    this.#speakers.connect(this.ctx.destination)
    // Diagnose (?debug=1 bzw. Tests): Pegel am Ausgang messbar machen.
    if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('debug')) {
      const analyser = this.ctx.createAnalyser()
      this.input.connect(analyser)
      ;(globalThis as { __qcAnalyser?: AnalyserNode }).__qcAnalyser = analyser
    }
  }

  setSpeakers(on: boolean): void {
    this.#speakers.gain.value = on ? 1 : 0
  }

  resume(): Promise<void> {
    return this.ctx.state === 'running' ? Promise.resolve() : this.ctx.resume()
  }

  close(): void {
    void this.ctx.close().catch(() => {})
  }
}
