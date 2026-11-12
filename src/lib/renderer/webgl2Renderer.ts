import type { TransitionType } from '../timeline/timeline'
import { BaseRenderer } from './baseRenderer'
import { coverCrop, isFrameReady, sourceSize, type FrameSource } from './geometry'
import { COVER_FRAGMENT, transitionFragment, VERTEX } from './shaders'

type ProgramName = 'cover' | Exclude<TransitionType, 'none'>

interface Prog {
  program: WebGLProgram
  u: Record<string, WebGLUniformLocation | null>
}

const UNIFORMS = ['uFrom', 'uTo', 'uScaleA', 'uOffsetA', 'uRotA', 'uScaleB', 'uOffsetB', 'uRotB', 'progress']

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

  #upload(unit: 0 | 1, video: FrameSource, rotation: number, prog: Prog) {
    const gl = this.#gl
    const size = sourceSize(video)
    const c = coverCrop(size.width, size.height, this.canvas.width, this.canvas.height, rotation)
    const s = unit === 0 ? 'A' : 'B'
    gl.activeTexture(unit === 0 ? gl.TEXTURE0 : gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this.#tex[unit])
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video)
    gl.uniform1i(prog.u[unit === 0 ? 'uFrom' : 'uTo']!, unit)
    gl.uniform2f(prog.u[`uScale${s}`]!, c.uvScale[0], c.uvScale[1])
    gl.uniform2f(prog.u[`uOffset${s}`]!, c.uvOffset[0], c.uvOffset[1])
    gl.uniform1f(prog.u[`uRot${s}`]!, (rotation * Math.PI) / 180)
  }

  protected override onResize(w: number, h: number): void {
    this.#gl.viewport(0, 0, w, h)
  }

  drawVideo(video: FrameSource, rotation = 0): void {
    if (!isFrameReady(video)) return
    const prog = this.#use('cover')
    this.#upload(0, video, rotation, prog)
    this.#gl.drawArrays(this.#gl.TRIANGLE_STRIP, 0, 4)
  }

  drawTransition(
    from: FrameSource,
    to: FrameSource,
    p: number,
    type: TransitionType,
    rotFrom = 0,
    rotTo = 0,
  ): void {
    if (type === 'none' || !isFrameReady(to)) return this.drawVideo(from, rotFrom)
    if (!isFrameReady(from)) return this.drawVideo(to, rotTo)
    const prog = this.#use(type)
    this.#upload(0, from, rotFrom, prog)
    this.#upload(1, to, rotTo, prog)
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
    this.#gl.getExtension('WEBGL_lose_context')?.loseContext()
  }
}
