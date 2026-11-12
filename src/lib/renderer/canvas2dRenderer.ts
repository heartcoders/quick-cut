import { BaseRenderer } from './baseRenderer'
import { coverCrop } from './geometry'

/** Fallback ohne WebGL2: gleiche Cover-Logik per drawImage. */
export class Canvas2DRenderer extends BaseRenderer {
  readonly kind = 'canvas2d' as const
  #ctx: CanvasRenderingContext2D

  constructor(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D) {
    super(canvas)
    this.#ctx = ctx
  }

  drawVideo(video: HTMLVideoElement, rotation = 0): void {
    if (video.readyState < 2 || !video.videoWidth) return
    const { width: W, height: H } = this.canvas
    const { scale } = coverCrop(video.videoWidth, video.videoHeight, W, H, rotation)
    const ctx = this.#ctx
    ctx.save()
    ctx.translate(W / 2, H / 2)
    ctx.rotate((rotation * Math.PI) / 180)
    const w = video.videoWidth * scale
    const h = video.videoHeight * scale
    ctx.drawImage(video, -w / 2, -h / 2, w, h)
    ctx.restore()
  }

  clear(): void {
    this.#ctx.fillStyle = '#000'
    this.#ctx.fillRect(0, 0, this.canvas.width, this.canvas.height)
  }
}
