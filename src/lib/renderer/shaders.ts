export const VERTEX = /* glsl */ `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`

/**
 * Cover-Shader: sichtbaren Ausschnitt (uScale/uOffset) der gedrehten Quelle
 * auf das ganze Ziel legen. Spätere Übergänge mischen hier zwei Texturen.
 */
export const COVER_FRAGMENT = /* glsl */ `#version 300 es
precision mediump float;
in vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uScale;
uniform vec2 uOffset;
uniform float uRot;
out vec4 outColor;
void main() {
  vec2 uv = uOffset + vUv * uScale;
  vec2 c = uv - 0.5;
  float s = sin(uRot);
  float k = cos(uRot);
  uv = vec2(k * c.x - s * c.y, s * c.x + k * c.y) + 0.5;
  outColor = texture(uTex, uv);
}`
