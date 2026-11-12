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

/**
 * Look (Filter + Effekte) pro Clip. Reihenfolge:
 * 1. UV-Verzerrung (VHS-Zeilenwackeln, Glitch-Blockversatz)
 * 2. Sampling mit RGB-Versatz (VHS, Glitch)
 * 3. Farbgrading (Sättigung, Kontrast, Helligkeit, Temperatur, Tönung, Sepia, Fade)
 * 4. Scanlines (VHS), Korn, Vignette
 * Zufall hängt nur von uTime (Timeline-Sekunden) ab → Export ist reproduzierbar.
 * Bei neutralem Look (alle Effekte 0, Grading = Identität) bleibt das Bild unverändert.
 */
const LOOK_FN = /* glsl */ `
uniform float uTime;
uniform vec2 uRes;
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
vec3 grade(vec3 c, vec4 g, vec4 g2) {
  c += g.z;
  c = (c - 0.5) * g.y + 0.5;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, g.x);
  c += vec3(g.w, g2.x, -g.w) * 0.1;
  vec3 sep = vec3(
    dot(c, vec3(0.393, 0.769, 0.189)),
    dot(c, vec3(0.349, 0.686, 0.168)),
    dot(c, vec3(0.272, 0.534, 0.131)));
  c = mix(c, sep, g2.z);
  c = c * (1.0 - 0.25 * g2.y) + 0.12 * g2.y;
  return c;
}
vec4 sampleLook(sampler2D tex, vec2 uv, vec2 sc, vec2 off, float rot, vec4 g, vec4 g2, vec4 fx) {
  float frame = floor(uTime * 30.0);
  float vhs = fx.z;
  float glitch = fx.w;
  vec2 suv = uv;
  if (vhs > 0.0) {
    float line = floor(uv.y * uRes.y / 4.0);
    suv.x += (hash(vec2(line, frame)) - 0.5) * 0.004 * vhs + sin(uv.y * 40.0 + uTime * 5.0) * 0.002 * vhs;
  }
  float split = 0.004 * vhs;
  if (glitch > 0.0) {
    float burst = step(1.0 - 0.6 * glitch, hash(vec2(floor(frame / 4.0), 11.0)));
    float band = floor(uv.y * 24.0);
    float on = step(1.0 - 0.3 * glitch, hash(vec2(band, floor(frame / 2.0)))) * burst;
    suv.x += on * (hash(vec2(band + 7.0, frame)) - 0.5) * 0.2 * glitch;
    split += 0.015 * glitch * burst;
  }
  vec3 c = texture(tex, coverUv(suv, sc, off, rot)).rgb;
  if (split > 0.0) {
    c.r = texture(tex, coverUv(suv + vec2(split, 0.0), sc, off, rot)).r;
    c.b = texture(tex, coverUv(suv - vec2(split, 0.0), sc, off, rot)).b;
  }
  c = grade(c, g, g2);
  if (vhs > 0.0) {
    c *= 1.0 - 0.18 * vhs * step(0.5, fract(uv.y * uRes.y / 4.0));
    c = mix(c, c * vec3(1.04, 0.97, 1.06) + vec3(0.0, 0.0, 0.02), vhs);
  }
  if (fx.x > 0.0) {
    c += (hash(floor(uv * uRes / 2.0) + frame * 1.37) - 0.5) * 0.3 * fx.x;
  }
  if (fx.y > 0.0) {
    vec2 d = (uv - 0.5) * vec2(uRes.x / max(uRes.x, uRes.y), uRes.y / max(uRes.x, uRes.y));
    float v = smoothstep(0.75, 0.2, length(d) * 1.1);
    c *= mix(1.0, v, fx.y * 0.9);
  }
  return vec4(clamp(c, 0.0, 1.0), 1.0);
}`

const SIDE_A = /* glsl */ `
uniform sampler2D uFrom;
uniform vec2 uScaleA;
uniform vec2 uOffsetA;
uniform float uRotA;
uniform vec4 uGradeA;
uniform vec4 uGrade2A;
uniform vec4 uFxA;`

/** Ein Clip ohne Übergang: Ziel füllen, zuschneiden, Look anwenden. */
export const COVER_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
${SIDE_A}
out vec4 outColor;
${COVER_FN}
${LOOK_FN}
void main() {
  outColor = sampleLook(uFrom, vUv, uScaleA, uOffsetA, uRotA, uGradeA, uGrade2A, uFxA);
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
precision highp float;
in vec2 vUv;
${SIDE_A}
uniform sampler2D uTo;
uniform vec2 uScaleB;
uniform vec2 uOffsetB;
uniform float uRotB;
uniform vec4 uGradeB;
uniform vec4 uGrade2B;
uniform vec4 uFxB;
uniform float progress;
out vec4 outColor;
${COVER_FN}
${LOOK_FN}
vec4 getFromColor(vec2 uv) { return sampleLook(uFrom, uv, uScaleA, uOffsetA, uRotA, uGradeA, uGrade2A, uFxA); }
vec4 getToColor(vec2 uv) { return sampleLook(uTo, uv, uScaleB, uOffsetB, uRotB, uGradeB, uGrade2B, uFxB); }
${TRANSITIONS[type]}
void main() {
  outColor = transition(vUv);
}`
}
