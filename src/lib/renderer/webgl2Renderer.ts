import type { TransitionType } from '../timeline/timeline'
import { BaseRenderer } from './baseRenderer'
import { CENTER, coverCrop, isFrameReady, sourceSize, type FrameSource, type Placement } from './geometry'
import { MAX_FACES, type FaceDraw } from '../faces/place'
import { stickerAtlas } from '../faces/stickers'
import { lookUniforms } from './looks'
import { COVER_FRAGMENT, transitionFragment, VERTEX } from './shaders'

type ProgramName = 'cover' | Exclude<TransitionType, 'none'>

interface Prog {
  program: WebGLProgram
  u: Record<string, WebGLUniformLocation | null>
}

const UNIFORMS = [
  'uFrom',
  'uTo',
  'progress',
  'uTime',
  'uRes',
  'uStickers',
  ...['A', 'B'].flatMap((s) => [
    `uScale${s}`,
    `uOffset${s}`,
    `uRot${s}`,
    `uGrade${s}`,
    `uGrade2${s}`,
    `uFx${s}`,
    `uFace${s}`,
    `uFaceFx${s}`,
    `uFaceN${s}`,
  ]),
]

/** Gesichter als Uniform-Arrays (vec4 je Gesicht, mit Nullen aufgefüllt). */
function faceUniforms(faces: FaceDraw[] | undefined): { ellipse: Float32Array; fx: Float32Array; n: number } {
  const ellipse = new Float32Array(MAX_FACES * 4)
  const fx = new Float32Array(MAX_FACES * 4)
  const list = (faces ?? []).slice(0, MAX_FACES)
  list.forEach((f, i) => {
    ellipse.set([f.cx, f.cy, Math.max(1e-4, f.rx), Math.max(1e-4, f.ry)], i * 4)
    fx.set([f.mode, f.strength, f.sticker, 0], i * 4)
  })
  return { ellipse, fx, n: list.length }
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? 'Shader-Fehler')
  return sh
}


export class WebGL2Renderer extends BaseRenderer {
  readonly kind = 'webgl2' as const
  #gl: WebGL2RenderingContext
  #tex: [WebGLTexture, WebGLTexture]
  #vertex: WebGLShader
  #programs = new Map<ProgramName, Prog>()
  #stickers: WebGLTexture | null = null

  constructor(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext) {
    super(canvas)
    this.#gl = gl
    this.#vertex = compile(gl, gl.VERTEX_SHADER, VERTEX)

    const vao = gl.createVertexArray()
    gl.bindVertexArray(vao)
    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)

    const mkTex = () => {
      const t = gl.createTexture()!
      gl.bindTexture(gl.TEXTURE_2D, t)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      return t
    }
    this.#tex = [mkTex(), mkTex()]
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
    this.#use('cover') // früh kompilieren → Fehler fallen beim Erzeugen auf (Fallback 2D)
  }

  /** Programme werden erst bei Bedarf kompiliert und dann wiederverwendet. */
  #use(name: ProgramName): Prog {
    const gl = this.#gl
    let p = this.#programs.get(name)
    if (!p) {
      const program = gl.createProgram()!
      gl.attachShader(program, this.#vertex)
      gl.attachShader(
        program,
        compile(gl, gl.FRAGMENT_SHADER, name === 'cover' ? COVER_FRAGMENT : transitionFragment(name)),
      )
      gl.bindAttribLocation(program, 0, 'aPos')
      gl.linkProgram(program)
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'Link-Fehler')
      const u: Prog['u'] = {}
      for (const n of UNIFORMS) u[n] = gl.getUniformLocation(program, n)
      p = { program, u }
      this.#programs.set(name, p)
    }
    gl.useProgram(p.program)
    return p
  }

  #upload(unit: 0 | 1, video: FrameSource, place: Placement, prog: Prog) {
    const gl = this.#gl
    const size = sourceSize(video)
    const { rotation } = place
    // Textur liegt wegen UNPACK_FLIP_Y mit y nach oben → panY spiegeln.
    const c = coverCrop(size.width, size.height, this.canvas.width, this.canvas.height, rotation, place.panX, 1 - place.panY)
    const s = unit === 0 ? 'A' : 'B'
    gl.activeTexture(unit === 0 ? gl.TEXTURE0 : gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this.#tex[unit])
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video)
    gl.uniform1i(prog.u[unit === 0 ? 'uFrom' : 'uTo']!, unit)
    gl.uniform2f(prog.u[`uScale${s}`]!, c.uvScale[0], c.uvScale[1])
    gl.uniform2f(prog.u[`uOffset${s}`]!, c.uvOffset[0], c.uvOffset[1])
    gl.uniform1f(prog.u[`uRot${s}`]!, (rotation * Math.PI) / 180)
    const look = lookUniforms(place.look)
    gl.uniform4fv(prog.u[`uGrade${s}`]!, look.grade)
    gl.uniform4fv(prog.u[`uGrade2${s}`]!, look.grade2)
    gl.uniform4fv(prog.u[`uFx${s}`]!, look.fx)
    const faces = faceUniforms(place.faces)
    gl.uniform4fv(prog.u[`uFace${s}`]!, faces.ellipse)
    gl.uniform4fv(prog.u[`uFaceFx${s}`]!, faces.fx)
    gl.uniform1i(prog.u[`uFaceN${s}`]!, faces.n)
    if (place.faces?.some((f) => f.mode === 3)) this.#bindStickers(prog)
  }

  /** Sticker-Atlas erst beim ersten Sticker hochladen (Texture Unit 2). */
  #bindStickers(prog: Prog) {
    const gl = this.#gl
    gl.activeTexture(gl.TEXTURE2)
    if (!this.#stickers) {
      this.#stickers = gl.createTexture()!
      gl.bindTexture(gl.TEXTURE_2D, this.#stickers)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, stickerAtlas())
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    } else {
      gl.bindTexture(gl.TEXTURE_2D, this.#stickers)
    }
    gl.uniform1i(prog.u.uStickers!, 2)
  }

  /** Gemeinsame Uniforms für Zeit und Auflösung (Korn, Scanlines, Vignette). */
  #frameUniforms(prog: Prog) {
    this.#gl.uniform1f(prog.u.uTime!, this.time)
    this.#gl.uniform2f(prog.u.uRes!, this.canvas.width, this.canvas.height)
  }

  protected override onResize(w: number, h: number): void {
    this.#gl.viewport(0, 0, w, h)
  }

  drawVideo(video: FrameSource, place: Placement = CENTER): void {
    if (!isFrameReady(video)) return
    const prog = this.#use('cover')
    this.#frameUniforms(prog)
    this.#upload(0, video, place, prog)
    this.#gl.drawArrays(this.#gl.TRIANGLE_STRIP, 0, 4)
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
    const prog = this.#use(type)
    this.#frameUniforms(prog)
    this.#upload(0, from, placeFrom, prog)
    this.#upload(1, to, placeTo, prog)
    this.#gl.uniform1f(prog.u.progress!, p)
    this.#gl.drawArrays(this.#gl.TRIANGLE_STRIP, 0, 4)
  }

  clear(): void {
    this.#gl.clearColor(0, 0, 0, 1)
    this.#gl.clear(this.#gl.COLOR_BUFFER_BIT)
  }

  override dispose(): void {
    super.dispose()
    for (const t of this.#tex) this.#gl.deleteTexture(t)
    if (this.#stickers) this.#gl.deleteTexture(this.#stickers)
    this.#gl.getExtension('WEBGL_lose_context')?.loseContext()
  }
}
