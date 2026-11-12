import type { TransitionType } from '../timeline/timeline'
import { BaseRenderer } from './baseRenderer'
import { coverCrop, easeInOut } from './geometry'

function isReady(v: HTMLVideoElement): boolean {
  return v.readyState >= 2 && v.videoWidth > 0
}

/** Fallback ohne WebGL2: gleiche Cover-Logik und gleiche Übergänge per Canvas 2D. */
export class Canvas2DRenderer extends BaseRenderer {
  readonly kind = 'canvas2d' as const
  #ctx: CanvasRenderingContext2D

  constructor(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D) {
    super(canvas)
    this.#ctx = ctx
  }

  /** Zeichnet ein Video formatfüllend, optional horizontal versetzt (dx in Pixeln). */
  #cover(video: HTMLVideoElement, rotation: number, dx = 0) {
    const { width: W, height: H } = this.canvas
    const { scale } = coverCrop(video.videoWidth, video.videoHeight, W, H, rotation)
    const ctx = this.#ctx
    ctx.save()
    ctx.translate(W / 2 + dx, H / 2)
    ctx.rotate((rotation * Math.PI) / 180)
    const w = video.videoWidth * scale
    const h = video.videoHeight * scale
    ctx.drawImage(video, -w / 2, -h / 2, w, h)
    ctx.restore()
  }

  drawVideo(video: HTMLVideoElement, rotation = 0): void {
    if (!isReady(video)) return
    this.#cover(video, rotation)
  }

  drawTransition(
    from: HTMLVideoElement,
    to: HTMLVideoElement,
    p: number,
    type: TransitionType,
    rotFrom = 0,
    rotTo = 0,
  ): void {
    if (type === 'none' || !isReady(to)) return this.drawVideo(from, rotFrom)
    if (!isReady(from)) return this.drawVideo(to, rotTo)
    const { width: W, height: H } = this.canvas
    const ctx = this.#ctx
    switch (type) {
      case 'crossfade':
        this.#cover(from, rotFrom)
        ctx.globalAlpha = p
        this.#cover(to, rotTo)
        ctx.globalAlpha = 1
        break
      case 'slide': {
        // Jeder Clip nur in seinem Bereich, sonst ragt der beschnittene Überstand hinein.
        const edge = (1 - easeInOut(p)) * W
        ctx.save()
        ctx.beginPath()
        ctx.rect(0, 0, edge, H)
        ctx.clip()
        this.#cover(from, rotFrom, edge - W)
        ctx.restore()
        ctx.save()
        ctx.beginPath()
        ctx.rect(edge, 0, W - edge, H)
        ctx.clip()
        this.#cover(to, rotTo, edge)
        ctx.restore()
        break
      }
      case 'wipe':
        this.#cover(from, rotFrom)
        ctx.save()
        ctx.beginPath()
        ctx.rect(0, 0, p * W, H)
        ctx.clip()
        this.#cover(to, rotTo)
        ctx.restore()
        break
    }
  }

  clear(): void {
    this.#ctx.fillStyle = '#000'
    this.#ctx.fillRect(0, 0, this.canvas.width, this.canvas.height)
  }
}
