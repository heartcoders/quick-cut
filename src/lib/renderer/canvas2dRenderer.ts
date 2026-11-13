import type { TransitionType } from '../timeline/timeline'
import { BaseRenderer } from './baseRenderer'
import type { ClipLook } from '../project/types'
import { CENTER, coverCrop, easeInOut, isFrameReady, sourceSize, type FrameSource, type Placement } from './geometry'
import type { FaceDraw } from '../faces/place'
import { STICKERS, stickerSize } from '../faces/stickers'
import { canvasFilter } from './looks'

const NOISE_SIZE = 256

/** Graues Rauschmuster fürs Filmkorn (einmal erzeugt, dann als Pattern verschoben). */
function makeNoise(): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = c.height = NOISE_SIZE
  const ctx = c.getContext('2d')!
  const img = ctx.createImageData(NOISE_SIZE, NOISE_SIZE)
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() * 255
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v
    img.data[i + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  return c
}

/**
 * Fallback ohne WebGL2: gleiche Cover-Logik und gleiche Übergänge per Canvas 2D.
 * Der Look ist hier nur angenähert: Filter über ctx.filter, Vignette als
 * radialer Verlauf, Korn als Rauschmuster. VHS und Glitch gibt es nur im
 * WebGL2-Renderer.
 */
export class Canvas2DRenderer extends BaseRenderer {
  readonly kind = 'canvas2d' as const
  #ctx: CanvasRenderingContext2D
  #noise: CanvasPattern | null = null
  #pixel: HTMLCanvasElement | null = null

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
    const filter = canvasFilter(place.look)
    if (filter !== 'none') ctx.filter = filter
    const w = size.width * scale
    const h = size.height * scale
    ctx.drawImage(video, -w / 2, -h / 2, w, h)
    ctx.restore()
    if (place.faces?.length) {
      // Aufrechtes, skaliertes Quellbild liegt mittig bei (W/2 + dx + px, H/2 + py).
      const ox = W / 2 + dx + px - ew / 2
      const oy = H / 2 + py - eh / 2
      this.#faces(video, place, filter, { ox, oy, ew, eh, w, h, dx: W / 2 + dx + px, dy: H / 2 + py })
    }
  }

  /**
   * Gesichter im bereits gezeichneten Bild bearbeiten. Weichzeichnen/Verpixeln
   * zeichnen die Quelle innerhalb der Ellipse noch einmal (mit Blur bzw. grob
   * gerastert), Sticker kommen als Emoji darüber.
   */
  #faces(
    video: FrameSource,
    place: Placement,
    filter: string,
    g: { ox: number; oy: number; ew: number; eh: number; w: number; h: number; dx: number; dy: number },
  ) {
    const ctx = this.#ctx
    const rot = (place.rotation * Math.PI) / 180
    const drawSource = (target: CanvasRenderingContext2D, extraFilter = '') => {
      target.save()
      target.translate(g.dx, g.dy)
      target.rotate(rot)
      const f = [filter !== 'none' ? filter : '', extraFilter].filter(Boolean).join(' ')
      if (f) target.filter = f
      target.drawImage(video, -g.w / 2, -g.h / 2, g.w, g.h)
      target.restore()
    }
    for (const f of place.faces as FaceDraw[]) {
      const cx = g.ox + f.cx * g.ew
      const cy = g.oy + f.cy * g.eh
      const rx = f.rx * g.ew
      const ry = f.ry * g.eh
      if (f.mode === 3) {
        const side = stickerSize(f.rx, f.ry, g.ew, g.eh)
        ctx.save()
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.font = `${Math.round(side * 0.82)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`
        ctx.fillText(STICKERS[f.sticker] ?? STICKERS[0], cx, cy + side * 0.04)
        ctx.restore()
        continue
      }
      ctx.save()
      ctx.beginPath()
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
      ctx.clip()
      const facePx = 2 * ry
      if (f.mode === 1) {
        drawSource(ctx, `blur(${Math.max(2, facePx * (0.03 + 0.09 * f.strength)).toFixed(1)}px)`)
      } else {
        // Verpixeln: Canvas verkleinert abtasten und ohne Glättung hochskalieren.
        const block = Math.max(3, facePx * (0.06 + 0.14 * f.strength))
        const { width: W, height: H } = this.canvas
        const sw = Math.max(1, Math.round(W / block))
        const sh = Math.max(1, Math.round(H / block))
        const pc = (this.#pixel ??= document.createElement('canvas'))
        if (pc.width !== sw) pc.width = sw
        if (pc.height !== sh) pc.height = sh
        const pctx = pc.getContext('2d')!
        pctx.setTransform(sw / W, 0, 0, sh / H, 0, 0)
        drawSource(pctx)
        ctx.imageSmoothingEnabled = false
        ctx.drawImage(pc, 0, 0, W, H)
      }
      ctx.restore()
    }
  }

  /** Vignette und Korn über das fertige Bild legen (alpha: Anteil im Übergang). */
  #effects(look: ClipLook | undefined, alpha = 1) {
    if (!look || alpha <= 0) return
    const { width: W, height: H } = this.canvas
    const ctx = this.#ctx
    if (look.vignette > 0) {
      const r = Math.hypot(W, H) / 2
      const g = ctx.createRadialGradient(W / 2, H / 2, r * 0.25, W / 2, H / 2, r)
      g.addColorStop(0, 'rgba(0,0,0,0)')
      g.addColorStop(1, `rgba(0,0,0,${0.85 * look.vignette * alpha})`)
      ctx.fillStyle = g
      ctx.fillRect(0, 0, W, H)
    }
    if (look.grain > 0) {
      this.#noise ??= ctx.createPattern(makeNoise(), 'repeat')
      if (!this.#noise) return
      // Pro Frame (30 fps) anders verschieben, damit das Korn lebt.
      const f = Math.floor(this.time * 30)
      ctx.save()
      ctx.globalAlpha = 0.35 * look.grain * alpha
      ctx.globalCompositeOperation = 'overlay'
      ctx.translate(-((f * 97) % NOISE_SIZE), -((f * 61) % NOISE_SIZE))
      ctx.fillStyle = this.#noise
      ctx.fillRect(0, 0, W + NOISE_SIZE, H + NOISE_SIZE)
      ctx.restore()
    }
  }

  drawVideo(video: FrameSource, place: Placement = CENTER): void {
    if (!isFrameReady(video)) return
    this.#cover(video, place)
    this.#effects(place.look)
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
    this.#effects(placeFrom.look, 1 - p)
    this.#effects(placeTo.look, p)
  }

  clear(): void {
    this.#ctx.fillStyle = '#000'
    this.#ctx.fillRect(0, 0, this.canvas.width, this.canvas.height)
  }
}
