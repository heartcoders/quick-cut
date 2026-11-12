import type { TransitionType } from '../timeline/timeline'
import { BaseRenderer } from './baseRenderer'
import { CENTER, coverCrop, easeInOut, isFrameReady, sourceSize, type FrameSource, type Placement } from './geometry'


/** Fallback ohne WebGL2: gleiche Cover-Logik und gleiche Übergänge per Canvas 2D. */
export class Canvas2DRenderer extends BaseRenderer {
  readonly kind = 'canvas2d' as const
  #ctx: CanvasRenderingContext2D

  constructor(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D) {
    super(canvas)
    this.#ctx = ctx
  }

  /** Zeichnet ein Video formatfüllend, optional horizontal versetzt (dx in Pixeln). */
  #cover(video: FrameSource, place: Placement, dx = 0) {
    const { width: W, height: H } = this.canvas
    const size = sourceSize(video)
    const { rotation, panX, panY } = place
    const { scale } = coverCrop(size.width, size.height, W, H, rotation)
    // Überstand der gedrehten, skalierten Quelle → um pan verschieben (0.5 = mittig).
    const swap = Math.abs(rotation) % 180 === 90
    const ew = (swap ? size.height : size.width) * scale
    const eh = (swap ? size.width : size.height) * scale
    const px = (0.5 - panX) * Math.max(0, ew - W)
    const py = (0.5 - panY) * Math.max(0, eh - H)
    const ctx = this.#ctx
    ctx.save()
    ctx.translate(W / 2 + dx + px, H / 2 + py)
    ctx.rotate((rotation * Math.PI) / 180)
    const w = size.width * scale
    const h = size.height * scale
    ctx.drawImage(video, -w / 2, -h / 2, w, h)
    ctx.restore()
  }

  drawVideo(video: FrameSource, place: Placement = CENTER): void {
    if (!isFrameReady(video)) return
    this.#cover(video, place)
  }

  drawTransition(
    from: FrameSource,
    to: FrameSource,
    p: number,
    type: TransitionType,
    placeFrom: Placement = CENTER,
    placeTo: Placement = CENTER,
  ): void {
    if (type === 'none' || !isFrameReady(to)) return this.drawVideo(from, placeFrom)
    if (!isFrameReady(from)) return this.drawVideo(to, placeTo)
    const { width: W, height: H } = this.canvas
    const ctx = this.#ctx
    switch (type) {
      case 'crossfade':
        this.#cover(from, placeFrom)
        ctx.globalAlpha = p
        this.#cover(to, placeTo)
        ctx.globalAlpha = 1
        break
      case 'slide': {
        // Jeder Clip nur in seinem Bereich, sonst ragt der beschnittene Überstand hinein.
        const edge = (1 - easeInOut(p)) * W
        ctx.save()
        ctx.beginPath()
        ctx.rect(0, 0, edge, H)
        ctx.clip()
        this.#cover(from, placeFrom, edge - W)
        ctx.restore()
        ctx.save()
        ctx.beginPath()
        ctx.rect(edge, 0, W - edge, H)
        ctx.clip()
        this.#cover(to, placeTo, edge)
        ctx.restore()
        break
      }
      case 'wipe':
        this.#cover(from, placeFrom)
        ctx.save()
        ctx.beginPath()
        ctx.rect(0, 0, p * W, H)
        ctx.clip()
        this.#cover(to, placeTo)
        ctx.restore()
        break
    }
  }

  clear(): void {
    this.#ctx.fillStyle = '#000'
    this.#ctx.fillRect(0, 0, this.canvas.width, this.canvas.height)
  }
}
