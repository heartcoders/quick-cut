import { BaseRenderer } from './baseRenderer'
import { coverCrop } from './geometry'
import { COVER_FRAGMENT, VERTEX } from './shaders'

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
  #tex: WebGLTexture
  #u: Record<'scale' | 'offset' | 'rot', WebGLUniformLocation | null>

  constructor(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext) {
    super(canvas)
    this.#gl = gl
    const prog = gl.createProgram()!
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERTEX))
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, COVER_FRAGMENT))
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'Link-Fehler')
    gl.useProgram(prog)

    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    const loc = gl.getAttribLocation(prog, 'aPos')
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)

    this.#tex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, this.#tex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)

    this.#u = {
      scale: gl.getUniformLocation(prog, 'uScale'),
      offset: gl.getUniformLocation(prog, 'uOffset'),
      rot: gl.getUniformLocation(prog, 'uRot'),
    }
  }

  protected override onResize(w: number, h: number): void {
    this.#gl.viewport(0, 0, w, h)
  }

  drawVideo(video: HTMLVideoElement, rotation = 0): void {
    if (video.readyState < 2 || !video.videoWidth) return
    const gl = this.#gl
    const c = coverCrop(video.videoWidth, video.videoHeight, this.canvas.width, this.canvas.height, rotation)
    gl.bindTexture(gl.TEXTURE_2D, this.#tex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video)
    gl.uniform2f(this.#u.scale, c.uvScale[0], c.uvScale[1])
    gl.uniform2f(this.#u.offset, c.uvOffset[0], c.uvOffset[1])
    gl.uniform1f(this.#u.rot, (rotation * Math.PI) / 180)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }

  clear(): void {
    this.#gl.clearColor(0, 0, 0, 1)
    this.#gl.clear(this.#gl.COLOR_BUFFER_BIT)
  }

  override dispose(): void {
    super.dispose()
    this.#gl.deleteTexture(this.#tex)
    this.#gl.getExtension('WEBGL_lose_context')?.loseContext()
  }
}
