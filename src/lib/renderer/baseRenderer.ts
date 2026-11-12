import { once, seekTo } from '../media/video'
import type { AspectRatio } from '../project/types'
import { resolveFrame, totalDuration, type TransitionSpec, type TransitionType } from '../timeline/timeline'
import { outputSize, type FrameSource } from './geometry'
import type { RenderClip, RenderProject, Renderer } from './types'

function hiddenVideo(): HTMLVideoElement {
  const v = document.createElement('video')
  v.muted = true
  v.playsInline = true
  v.preload = 'auto'
  // iOS liefert Frames nur von eingehängten Videos zuverlässig.
  Object.assign(v.style, { position: 'fixed', width: '1px', height: '1px', opacity: '0', pointerEvents: 'none' })
  document.body.append(v)
  return v
}

async function showAt(v: HTMLVideoElement, clip: RenderClip, t: number): Promise<void> {
  if (v.src !== clip.url) {
    v.src = clip.url
    v.load()
    await once(v, ['loadedmetadata', 'error'], 5000)
  }
  await seekTo(v, Math.min(t, Math.max(0, clip.duration - 0.05)))
}

/** Gemeinsamer Teil: Projekt, Zielgröße, Standbild per Seek (auch mitten im Übergang). */
export abstract class BaseRenderer implements Renderer {
  readonly canvas: HTMLCanvasElement
  abstract readonly kind: Renderer['kind']
  #clips: RenderClip[] = []
  #transitions: TransitionSpec[] = []
  #stills: [HTMLVideoElement, HTMLVideoElement]

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.#stills = [hiddenVideo(), hiddenVideo()]
  }

  get totalDuration(): number {
    return totalDuration(this.#clips, this.#transitions)
  }

  async load(project: RenderProject): Promise<void> {
    this.#clips = project.clips
    this.#transitions = project.transitions
    this.setOutput(project.outputAspect)
  }

  setOutput(aspect: AspectRatio): void {
    const { width, height } = outputSize(aspect)
    if (this.canvas.width !== width) this.canvas.width = width
    if (this.canvas.height !== height) this.canvas.height = height
    this.onResize(width, height)
  }

  async renderFrame(t: number): Promise<void> {
    const f = resolveFrame(this.#clips, this.#transitions, t)
    if (!f) return this.clear()
    const [a, b] = this.#stills
    const from = this.#clips[f.from.index]!
    await showAt(a, from, f.from.localTime)
    if (f.to) {
      const to = this.#clips[f.to.index]!
      await showAt(b, to, f.to.localTime)
      this.drawTransition(a, b, f.p, f.type, from.rotation, to.rotation)
    } else {
      this.drawVideo(a, from.rotation)
    }
  }

  protected onResize(_w: number, _h: number): void {}
  abstract drawVideo(video: FrameSource, rotation?: number): void
  abstract drawTransition(
    from: FrameSource,
    to: FrameSource,
    p: number,
    type: TransitionType,
    rotFrom?: number,
    rotTo?: number,
  ): void
  abstract clear(): void

  dispose(): void {
    for (const v of this.#stills) {
      v.removeAttribute('src')
      v.load()
      v.remove()
    }
  }
}
