import { Canvas2DRenderer } from './canvas2dRenderer'
import type { Renderer } from './types'
import { WebGL2Renderer } from './webgl2Renderer'

/** WebGL2 bevorzugt; ohne WebGL2 (oder bei Shader-Fehler) Canvas 2D. */
export function createRenderer(): Renderer {
  const canvas = document.createElement('canvas')
  try {
    // preserveDrawingBuffer: captureStream liest den Buffer auch zwischen den Frames.
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, preserveDrawingBuffer: true })
    if (gl) return new WebGL2Renderer(canvas, gl)
  } catch (err) {
    console.warn('WebGL2 nicht nutzbar, Fallback auf Canvas 2D', err)
  }
  const fallback = document.createElement('canvas')
  return new Canvas2DRenderer(fallback, fallback.getContext('2d', { alpha: false })!)
}
