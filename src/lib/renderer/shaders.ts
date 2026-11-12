import type { TransitionType } from '../timeline/timeline'

export const VERTEX = /* glsl */ `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`

const COVER_FN = /* glsl */ `
vec2 coverUv(vec2 uv, vec2 sc, vec2 off, float rot) {
  vec2 c = off + uv * sc - 0.5;
  float s = sin(rot);
  float k = cos(rot);
  return vec2(k * c.x - s * c.y, s * c.x + k * c.y) + 0.5;
}`

/** Ein Clip ohne Übergang: Ziel füllen, mittig zuschneiden. */
export const COVER_FRAGMENT = /* glsl */ `#version 300 es
precision mediump float;
in vec2 vUv;
uniform sampler2D uFrom;
uniform vec2 uScaleA;
uniform vec2 uOffsetA;
uniform float uRotA;
out vec4 outColor;
${COVER_FN}
void main() {
  outColor = texture(uFrom, coverUv(vUv, uScaleA, uOffsetA, uRotA));
}`

/**
 * Übergänge mit der Signatur von gl-transitions (getFromColor, getToColor,
 * progress, transition(uv)), damit sich später weitere aus der Sammlung
 * einheitlich einbinden lassen. Die drei hier sind eigene, einfache Varianten.
 * Wichtig: Canvas2DRenderer muss dieselbe Optik liefern.
 */
export const TRANSITIONS: Record<Exclude<TransitionType, 'none'>, string> = {
  crossfade: /* glsl */ `
vec4 transition(vec2 uv) {
  return mix(getFromColor(uv), getToColor(uv), progress);
}`,
  // Neuer Clip schiebt den alten nach links hinaus.
  slide: /* glsl */ `
vec4 transition(vec2 uv) {
  float e = progress * progress * (3.0 - 2.0 * progress);
  float x = uv.x + e;
  return x < 1.0 ? getFromColor(vec2(x, uv.y)) : getToColor(vec2(x - 1.0, uv.y));
}`,
  // Kante läuft von links nach rechts, leicht weich.
  wipe: /* glsl */ `
vec4 transition(vec2 uv) {
  float s = 0.02;
  float edge = progress * (1.0 + s);
  float m = smoothstep(edge - s, edge, uv.x);
  return mix(getToColor(uv), getFromColor(uv), m);
}`,
}

export function transitionFragment(type: Exclude<TransitionType, 'none'>): string {
  return /* glsl */ `#version 300 es
precision mediump float;
in vec2 vUv;
uniform sampler2D uFrom;
uniform sampler2D uTo;
uniform vec2 uScaleA;
uniform vec2 uOffsetA;
uniform float uRotA;
uniform vec2 uScaleB;
uniform vec2 uOffsetB;
uniform float uRotB;
uniform float progress;
out vec4 outColor;
${COVER_FN}
vec4 getFromColor(vec2 uv) { return texture(uFrom, coverUv(uv, uScaleA, uOffsetA, uRotA)); }
vec4 getToColor(vec2 uv) { return texture(uTo, coverUv(uv, uScaleB, uOffsetB, uRotB)); }
${TRANSITIONS[type]}
void main() {
  outColor = transition(vUv);
}`
}
