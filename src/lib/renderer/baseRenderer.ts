import { once, seekTo } from '../media/video'
import type { AspectRatio } from '../project/types'
import { resolve, totalDuration } from '../timeline/timeline'
import { outputSize } from './geometry'
import type { RenderClip, RenderProject, Renderer } from './types'

/** Gemeinsamer Teil: Projekt, Zielgröße, Standbild per Seek. */
export abstract class BaseRenderer implements Renderer {
  readonly canvas: HTMLCanvasElement
  abstract readonly kind: Renderer['kind']
  #clips: RenderClip[] = []
  #still: HTMLVideoElement

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.#still = document.createElement('video')
    this.#still.muted = true
    this.#still.playsInline = true
    this.#still.preload = 'auto'
    // iOS liefert Frames nur von eingehängten Videos zuverlässig.
    Object.assign(this.#still.style, { position: 'fixed', width: '1px', height: '1px', opacity: '0', pointerEvents: 'none' })
    document.body.append(this.#still)
  }

  get totalDuration(): number {
    return totalDuration(this.#clips)
  }

  async load(project: RenderProject): Promise<void> {
    this.#clips = project.clips
    this.setOutput(project.outputAspect)
  }

  setOutput(aspect: AspectRatio): void {
    const { width, height } = outputSize(aspect)
    if (this.canvas.width !== width) this.canvas.width = width
    if (this.canvas.height !== height) this.canvas.height = height
    this.onResize(width, height)
  }

  async renderFrame(t: number): Promise<void> {
    const r = resolve(this.#clips, t)
    if (!r) return this.clear()
    const clip = this.#clips[r.index]!
    const v = this.#still
    if (v.src !== clip.url) {
      v.src = clip.url
      v.load()
      await once(v, ['loadedmetadata', 'error'], 5000)
    }
    await seekTo(v, Math.min(r.localTime, Math.max(0, clip.duration - 0.05)))
    this.drawVideo(v, clip.rotation)
  }

  protected onResize(_w: number, _h: number): void {}
  abstract drawVideo(video: HTMLVideoElement, rotation?: number): void
  abstract clear(): void

  dispose(): void {
    this.#still.removeAttribute('src')
    this.#still.load()
    this.#still.remove()
  }
}
