import { MAX_FACES } from '../faces/place'
import { ATLAS_GRID, STICKER_SCALE } from '../faces/stickers'
import type { TransitionType } from '../timeline/timeline'

export const VERTEX = /* glsl */ `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`

/**
 * e = off + uv * sc ist die Koordinate im aufrechten Quellbild (y nach oben,
 * wegen UNPACK_FLIP_Y). rotUv dreht sie in die Texturkoordinate.
 */
const COVER_FN = /* glsl */ `
vec2 rotUv(vec2 e, float rot) {
  vec2 c = e - 0.5;
  float s = sin(rot);
  float k = cos(rot);
  return vec2(k * c.x - s * c.y, s * c.x + k * c.y) + 0.5;
}
vec2 coverUv(vec2 uv, vec2 sc, vec2 off, float rot) {
  return rotUv(off + uv * sc, rot);
}`

/**
 * Gesichter (siehe faces/place.ts): faces[i] = Ellipse (cx, cy, rx, ry) im
 * aufrechten Bild mit y nach unten, ffx[i] = (Modus 1 Blur | 2 Pixel | 3 Sticker,
 * Stärke, Sticker-Index, –). Alles im Quellraum → wandert mit Pan und Übergang.
 */
const FACE_FN = /* glsl */ `
uniform sampler2D uStickers;
vec2 faceCenter(vec4 f) { return vec2(f.x, 1.0 - f.y); }
// Groesse des aufrechten Quellbilds in Pixeln
vec2 uprightSize(sampler2D tex, float rot) {
  vec2 ts = vec2(textureSize(tex, 0));
  return abs(sin(rot)) > 0.5 ? ts.yx : ts;
}
// Weichgezeichnete bzw. verpixelte Farbe (rgb) und Maske (a) an e
vec4 faceColor(sampler2D tex, vec2 e, float rot, vec4 faces[MAX_FACES], vec4 ffx[MAX_FACES], int n) {
  vec2 px = uprightSize(tex, rot);
  for (int i = 0; i < MAX_FACES; i++) {
    if (i >= n) break;
    if (ffx[i].x > 2.5) continue;
    vec4 f = faces[i];
    float d = length((e - faceCenter(f)) / f.zw);
    if (d >= 1.0) continue;
    float m = 1.0 - smoothstep(0.85, 1.0, d);
    float facePx = 2.0 * f.w * px.y;
    vec3 c = vec3(0.0);
    if (ffx[i].x < 1.5) {
      // Spirale (goldener Winkel), pro Pixel gedreht: Aliasing wird zu feinem Rauschen
      vec2 rad = facePx * (0.05 + 0.15 * ffx[i].y) / px;
      float j = hash(gl_FragCoord.xy) * 6.2832;
      for (int k = 0; k < 32; k++) {
        float fk = float(k) + 0.5;
        float a = fk * 2.39996 + j;
        c += textureLod(tex, rotUv(e + vec2(cos(a), sin(a)) * sqrt(fk / 32.0) * rad, rot), 0.0).rgb;
      }
      c /= 32.0;
    } else {
      vec2 cell = max(3.0, facePx * (0.06 + 0.14 * ffx[i].y)) / px;
      c = textureLod(tex, rotUv((floor(e / cell) + 0.5) * cell, rot), 0.0).rgb;
    }
    return vec4(c, m);
  }
  return vec4(0.0);
}
// Emoji-Sticker ueber die Gesichter legen (Atlas, vormultipliziertes Alpha)
vec3 faceStickers(vec3 c, vec2 e, vec2 px, vec4 faces[MAX_FACES], vec4 ffx[MAX_FACES], int n) {
  const float G = ${ATLAS_GRID}.0;
  for (int i = 0; i < MAX_FACES; i++) {
    if (i >= n) break;
    if (ffx[i].x < 2.5) continue;
    vec4 f = faces[i];
    float side = max(2.0 * f.z * px.x, 2.0 * f.w * px.y) * ${STICKER_SCALE.toFixed(2)};
    vec2 l = (e - faceCenter(f)) * px / side + 0.5;
    if (l.x < 0.0 || l.y < 0.0 || l.x > 1.0 || l.y > 1.0) continue;
    vec2 cell = vec2(mod(ffx[i].z, G), floor(ffx[i].z / G));
    vec2 auv = vec2((cell.x + l.x) / G, 1.0 - (cell.y + 1.0 - l.y) / G);
    vec4 s = textureLod(uStickers, auv, 0.0);
    c = c * (1.0 - s.a) + s.rgb;
  }
  return c;
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
${FACE_FN}
vec4 sampleLook(sampler2D tex, vec2 uv, vec2 sc, vec2 off, float rot, vec4 g, vec4 g2, vec4 fx,
                vec4 faces[MAX_FACES], vec4 ffx[MAX_FACES], int nf) {
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
  vec2 e = off + suv * sc;
  vec3 c = texture(tex, rotUv(e, rot)).rgb;
  if (split > 0.0) {
    c.r = texture(tex, coverUv(suv + vec2(split, 0.0), sc, off, rot)).r;
    c.b = texture(tex, coverUv(suv - vec2(split, 0.0), sc, off, rot)).b;
  }
  // nach dem RGB-Versatz, damit kein Farbkanal das Gesicht unveraendert zeigt
  if (nf > 0) {
    vec4 fc = faceColor(tex, e, rot, faces, ffx, nf);
    c = mix(c, fc.rgb, fc.a);
  }
  c = grade(c, g, g2);
  if (nf > 0) c = faceStickers(c, e, uprightSize(tex, rot), faces, ffx, nf);
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
#define MAX_FACES ${MAX_FACES}
uniform sampler2D uFrom;
uniform vec2 uScaleA;
uniform vec2 uOffsetA;
uniform float uRotA;
uniform vec4 uGradeA;
uniform vec4 uGrade2A;
uniform vec4 uFxA;
uniform vec4 uFaceA[MAX_FACES];
uniform vec4 uFaceFxA[MAX_FACES];
uniform int uFaceNA;`

/** Ein Clip ohne Übergang: Ziel füllen, zuschneiden, Look anwenden. */
export const COVER_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
${SIDE_A}
out vec4 outColor;
${COVER_FN}
${LOOK_FN}
void main() {
  outColor = sampleLook(uFrom, vUv, uScaleA, uOffsetA, uRotA, uGradeA, uGrade2A, uFxA, uFaceA, uFaceFxA, uFaceNA);
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
uniform vec4 uFaceB[MAX_FACES];
uniform vec4 uFaceFxB[MAX_FACES];
uniform int uFaceNB;
uniform float progress;
out vec4 outColor;
${COVER_FN}
${LOOK_FN}
vec4 getFromColor(vec2 uv) { return sampleLook(uFrom, uv, uScaleA, uOffsetA, uRotA, uGradeA, uGrade2A, uFxA, uFaceA, uFaceFxA, uFaceNA); }
vec4 getToColor(vec2 uv) { return sampleLook(uTo, uv, uScaleB, uOffsetB, uRotB, uGradeB, uGrade2B, uFxB, uFaceB, uFaceFxB, uFaceNB); }
${TRANSITIONS[type]}
void main() {
  outColor = transition(vUv);
}`
}
