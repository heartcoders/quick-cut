/**
 * Ton der Clip-Videos über die Web Audio API: pro <video> eine Quelle mit
 * eigenem Gain (Phase 6: Überblendungen), Ausgang an Lautsprecher und/oder
 * einen MediaStream für den Export.
 */
export class AudioGraph {
  readonly ctx: AudioContext
  readonly stream: MediaStream
  #speakers: GainNode
  #dest: MediaStreamAudioDestinationNode
  #gains = new WeakMap<HTMLMediaElement, GainNode>()

  /** Im Tap erzeugen – iOS startet den Context sonst im Zustand „suspended“. */
  constructor() {
    this.ctx = new AudioContext()
    this.#dest = this.ctx.createMediaStreamDestination()
    this.stream = this.#dest.stream
    this.#speakers = this.ctx.createGain()
    this.#speakers.connect(this.ctx.destination)
  }

  /** Pro Element nur einmal möglich; danach läuft dessen Ton nur noch durch den Graph. */
  attach(el: HTMLMediaElement): GainNode {
    let g = this.#gains.get(el)
    if (!g) {
      const src = this.ctx.createMediaElementSource(el)
      g = this.ctx.createGain()
      src.connect(g)
      g.connect(this.#dest)
      g.connect(this.#speakers)
      this.#gains.set(el, g)
    }
    return g
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
