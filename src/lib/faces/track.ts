/**
 * Face Tracking aus Einzelerkennungen: Zuordnung über die Zeit (IDs),
 * Glättung und Abfrage zu beliebigen Zeitpunkten. Reine Funktionen, keine DOM-APIs.
 *
 * Koordinaten sind normiert auf das aufrechte Bild (0…1, y nach unten).
 */

/** Erkanntes Gesicht in einem Frame (linke obere Ecke, Breite, Höhe). */
export interface Box {
  x: number
  y: number
  w: number
  h: number
  score: number
}

/** Ein Gesicht über die Zeit: Samples als [t, cx, cy, rx, ry] (Ellipse). */
export interface FaceTrackEntry {
  id: number
  samples: [number, number, number, number, number][]
}

/** Gesicht zu einem Zeitpunkt als Ellipse. */
export interface FaceAt {
  id: number
  cx: number
  cy: number
  rx: number
  ry: number
}

export interface TrackOptions {
  /** Längste Lücke (s), über die ein Gesicht weiterverfolgt wird. */
  maxGap: number
  /** Kürzere Tracks gelten als Fehlerkennung. */
  minSamples: number
  /** Halbe Fensterbreite der Glättung (Samples). */
  smooth: number
}

export const TRACK_DEFAULTS: TrackOptions = { maxGap: 0.5, minSamples: 3, smooth: 2 }

/**
 * Wie weit ein Track über sein erstes/letztes Sample hinaus gilt (s). Lieber
 * etwas länger abdecken als ein Gesicht zwischen zwei Samples frei zeigen.
 */
export const EDGE_HOLD = 0.15

export function iou(a: Box, b: Box): number {
  const x1 = Math.max(a.x, b.x)
  const y1 = Math.max(a.y, b.y)
  const x2 = Math.min(a.x + a.w, b.x + b.w)
  const y2 = Math.min(a.y + a.h, b.y + b.h)
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1)
  const union = a.w * a.h + b.w * b.h - inter
  return union > 0 ? inter / union : 0
}

/** Doppelte Erkennungen (z. B. aus überlappenden Kacheln) zusammenfassen. */
export function nms(boxes: Box[], threshold = 0.3): Box[] {
  const sorted = [...boxes].sort((a, b) => b.score - a.score)
  const out: Box[] = []
  for (const b of sorted) {
    // Auch eine Box, die fast ganz in einer anderen liegt, ist ein Duplikat.
    const dup = out.some((o) => iou(o, b) > threshold || containment(b, o) > 0.7)
    if (!dup) out.push(b)
  }
  return out
}

/** Anteil von a, der in b liegt. */
function containment(a: Box, b: Box): number {
  const x1 = Math.max(a.x, b.x)
  const y1 = Math.max(a.y, b.y)
  const x2 = Math.min(a.x + a.w, b.x + b.w)
  const y2 = Math.min(a.y + a.h, b.y + b.h)
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1)
  return a.w * a.h > 0 ? inter / (a.w * a.h) : 0
}

/** Ähnlichkeit für die Zuordnung: IoU, sonst Nähe der Mittelpunkte. Unter 0 = passt nicht. */
function affinity(last: Box, b: Box): number {
  const o = iou(last, b)
  if (o > 0.05) return 1 + o
  const dx = last.x + last.w / 2 - (b.x + b.w / 2)
  const dy = last.y + last.h / 2 - (b.y + b.h / 2)
  const dist = Math.hypot(dx, dy) / Math.max(last.w, last.h, b.w, b.h)
  return dist < 0.8 ? 1 - dist : -1
}

interface RawTrack {
  id: number
  lastT: number
  last: Box
  boxes: { t: number; box: Box }[]
}

/**
 * Ordnet Erkennungen fortlaufend Tracks zu (greedy nach Ähnlichkeit).
 * `push` liefert für jede Box die Track-ID – so lassen sich schon während der
 * Analyse Vorschaubilder pro Gesicht sammeln.
 */
export class Tracker {
  #open: RawTrack[] = []
  #done: RawTrack[] = []
  #nextId = 1
  #opts: TrackOptions

  constructor(opts: Partial<TrackOptions> = {}) {
    this.#opts = { ...TRACK_DEFAULTS, ...opts }
  }

  push(t: number, boxes: Box[]): number[] {
    // Zu lange nicht gesehene Tracks abschließen.
    this.#open = this.#open.filter((tr) => {
      if (t - tr.lastT <= this.#opts.maxGap) return true
      this.#done.push(tr)
      return false
    })
    const pairs: { ti: number; bi: number; a: number }[] = []
    this.#open.forEach((tr, ti) =>
      boxes.forEach((b, bi) => {
        const a = affinity(tr.last, b)
        if (a > 0) pairs.push({ ti, bi, a })
      }),
    )
    pairs.sort((p, q) => q.a - p.a)
    const ids = boxes.map(() => 0)
    const usedTrack = new Set<number>()
    for (const p of pairs) {
      if (usedTrack.has(p.ti) || ids[p.bi]) continue
      usedTrack.add(p.ti)
      const tr = this.#open[p.ti]!
      ids[p.bi] = tr.id
      tr.last = boxes[p.bi]!
      tr.lastT = t
      tr.boxes.push({ t, box: boxes[p.bi]! })
    }
    boxes.forEach((b, bi) => {
      if (ids[bi]) return
      const tr: RawTrack = { id: this.#nextId++, lastT: t, last: b, boxes: [{ t, box: b }] }
      this.#open.push(tr)
      ids[bi] = tr.id
    })
    return ids
  }

  /** Alle Tracks: zu kurze verworfen, geglättet, als Ellipse (IDs wie bei `push`). */
  finish(): FaceTrackEntry[] {
    const all = [...this.#done, ...this.#open].sort((a, b) => a.id - b.id)
    return all.filter((tr) => tr.boxes.length >= this.#opts.minSamples).map((tr) => toEntry(tr, this.#opts.smooth))
  }
}

/**
 * Box → Ellipse. BlazeFace-Boxen sind eng (Stirn und Kinn knapp, Haare fehlen),
 * daher großzügig erweitern und etwas nach oben schieben.
 */
export function boxToEllipse(b: Box): [number, number, number, number] {
  return [b.x + b.w / 2, b.y + b.h / 2 - b.h * 0.08, (b.w / 2) * 1.35, (b.h / 2) * 1.5]
}

function toEntry(tr: RawTrack, k: number): FaceTrackEntry {
  const el = tr.boxes.map(({ box }) => boxToEllipse(box))
  const samples = tr.boxes.map(({ t }, i) => {
    const lo = Math.max(0, i - k)
    const hi = Math.min(el.length - 1, i + k)
    const avg = [0, 0, 0, 0]
    for (let j = lo; j <= hi; j++) for (let c = 0; c < 4; c++) avg[c]! += el[j]![c]!
    const n = hi - lo + 1
    // Größe: Maximum statt Mittelwert, damit das Gesicht nie zu knapp abgedeckt ist.
    let rx = 0
    let ry = 0
    for (let j = lo; j <= hi; j++) {
      rx = Math.max(rx, el[j]![2])
      ry = Math.max(ry, el[j]![3])
    }
    const r3 = (v: number) => Math.round(v * 1e4) / 1e4
    return [r3(t), r3(avg[0]! / n), r3(avg[1]! / n), r3(rx), r3(ry)] as [number, number, number, number, number]
  })
  return { id: tr.id, samples }
}

/** Alle Gesichter zum Zeitpunkt t (lineare Interpolation zwischen Samples). */
export function facesAt(tracks: readonly FaceTrackEntry[], t: number): FaceAt[] {
  const out: FaceAt[] = []
  for (const tr of tracks) {
    const s = tr.samples
    if (s.length === 0) continue
    const first = s[0]!
    const last = s[s.length - 1]!
    if (t < first[0] - EDGE_HOLD || t > last[0] + EDGE_HOLD) continue
    if (t <= first[0]) {
      out.push({ id: tr.id, cx: first[1], cy: first[2], rx: first[3], ry: first[4] })
      continue
    }
    if (t >= last[0]) {
      out.push({ id: tr.id, cx: last[1], cy: last[2], rx: last[3], ry: last[4] })
      continue
    }
    // Binärsuche: letztes Sample mit s[i][0] <= t
    let lo = 0
    let hi = s.length - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (s[mid]![0] <= t) lo = mid
      else hi = mid
    }
    const a = s[lo]!
    const b = s[hi]!
    const p = b[0] > a[0] ? (t - a[0]) / (b[0] - a[0]) : 0
    const mix = (i: 1 | 2 | 3 | 4) => a[i] + (b[i] - a[i]) * p
    // Radien: Maximum, damit der Übergang zwischen zwei Größen nichts freilegt.
    out.push({ id: tr.id, cx: mix(1), cy: mix(2), rx: Math.max(a[3], b[3]), ry: Math.max(a[4], b[4]) })
  }
  return out
}
