export type Facing = 'user' | 'environment'
export type Lens = 'ultra' | 'wide' | 'tele'
export type CameraErrorKind = 'insecure' | 'denied' | 'notfound' | 'busy' | 'other'

export class CameraError extends Error {
  constructor(
    readonly kind: CameraErrorKind,
    cause?: unknown,
  ) {
    super(`Kamera nicht verfügbar: ${kind}`, { cause })
  }
}

export interface CameraRequest {
  facing: Facing
  /** Bestimmtes Objektiv; fehlt oder ist veraltet → Standardkamera der Seite. */
  deviceId?: string
}

/**
 * 1920×1920 als „ideal“ ist Absicht: Der Abstand zu 1920×1440 (4:3, volles
 * Sensor-Bildfeld) ist kleiner als zu 1920×1080 (16:9, bereits beschnitten) –
 * egal, ob der Browser die Werte im Hoch- oder Querformat auslegt. Eine feste
 * 1080×1920-Vorgabe lieferte auf iOS einen engen 16:9-Ausschnitt („Zoom“).
 */
function videoConstraints({ facing, deviceId }: CameraRequest): MediaTrackConstraints {
  const size = { width: { ideal: 1920 }, height: { ideal: 1920 } }
  return deviceId ? { deviceId: { exact: deviceId }, ...size } : { facingMode: facing, ...size }
}

function classify(err: unknown): CameraErrorKind {
  const name = err instanceof DOMException ? err.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied'
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'notfound'
  if (name === 'NotReadableError' || name === 'AbortError') return 'busy'
  return 'other'
}

async function request(req: CameraRequest): Promise<MediaStream> {
  const video = videoConstraints(req)
  try {
    return await navigator.mediaDevices.getUserMedia({ video, audio: true })
  } catch (err) {
    // Kein Mikrofon vorhanden → wenigstens Video.
    if (err instanceof DOMException && err.name === 'NotFoundError') {
      return await navigator.mediaDevices.getUserMedia({ video, audio: false })
    }
    throw err
  }
}

/** Öffnet Kamera + Mikrofon. Ohne Mikrofon wird nur Video angefordert. */
export async function openCamera(req: CameraRequest): Promise<MediaStream> {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    throw new CameraError('insecure')
  }
  let stream: MediaStream
  try {
    stream = await request(req)
  } catch (err) {
    const stale = err instanceof DOMException && (err.name === 'OverconstrainedError' || err.name === 'NotFoundError')
    if (!req.deviceId || !stale) throw new CameraError(classify(err), err)
    // deviceIds können sich ändern (z. B. nach Löschen der Website-Daten).
    try {
      stream = await request({ facing: req.facing })
    } catch (err2) {
      throw new CameraError(classify(err2), err2)
    }
  }
  await widestZoom(stream)
  await preferFullSensor(stream)
  return stream
}

/**
 * 4:3-Größen (lange Seite ≤ 1920) in der Ausrichtung des aktuellen Formats,
 * größte zuerst. Leer, wenn das Format nicht nach beschnittenem 16:9 aussieht.
 */
export function fourByThreeCandidates(width: number, height: number): { width: number; height: number }[] {
  if (!width || !height) return []
  const long = Math.max(width, height)
  const short = Math.min(width, height)
  if (long / short < 1.6) return []
  const portrait = width < height
  const sizes: [number, number][] = [
    [1920, 1440],
    [1440, 1080],
    [1280, 960],
    [640, 480],
  ]
  return sizes.map(([l, s]) => (portrait ? { width: s, height: l } : { width: l, height: s }))
}

/**
 * Ältere iPhones liefern vorne gern einen beschnittenen 16:9-Modus, wenn
 * 1920×1440 nicht angeboten wird. Dann eine 4:3-Größe (volles Bildfeld) erzwingen.
 */
async function preferFullSensor(stream: MediaStream): Promise<void> {
  const track = stream.getVideoTracks()[0]
  if (!track?.applyConstraints) return
  const s = track.getSettings()
  for (const size of fourByThreeCandidates(s.width ?? 0, s.height ?? 0)) {
    try {
      await track.applyConstraints({ width: { exact: size.width }, height: { exact: size.height } })
      return
    } catch {
      // Größe nicht verfügbar – nächste probieren.
    }
  }
}

/** Kleinsten Zoom einstellen, den die Kamera anbietet (Safari ≥ 17 kennt `zoom`). */
async function widestZoom(stream: MediaStream): Promise<void> {
  const track = stream.getVideoTracks()[0]
  const min = (track?.getCapabilities?.() as { zoom?: { min?: number } } | undefined)?.zoom?.min
  const current = (track?.getSettings() as { zoom?: number } | undefined)?.zoom
  if (!track || min === undefined || current === undefined || current <= min) return
  try {
    await track.applyConstraints({ advanced: [{ zoom: min } as MediaTrackConstraintSet] })
  } catch {
    // Kein Zoom möglich – dann eben mit Standard-Bildfeld.
  }
}

/** Stoppt alle Tracks, sonst bleibt die Kamera-LED an. */
export function stopStream(stream: MediaStream | null | undefined): void {
  stream?.getTracks().forEach((t) => t.stop())
}

export function isStreamLive(stream: MediaStream | null | undefined): boolean {
  return !!stream && stream.getVideoTracks().some((t) => t.readyState === 'live')
}

// ---------------------------------------------------------------------------
// Objektive

export interface CameraDevice {
  id: string
  label: string
  facing: Facing | null
  lens: Lens
  /** iOS-„Dual/Triple-Kamera“: schaltet selbst zwischen Objektiven um. */
  virtual: boolean
}

/**
 * Ordnet ein Gerät anhand seines Namens ein. iOS liefert lokalisierte Namen,
 * z. B. „Rückseitige Ultraweitwinkelkamera“ / „Back Ultra Wide Camera“.
 */
export function classifyCamera(label: string): Pick<CameraDevice, 'facing' | 'lens' | 'virtual'> {
  const facing: Facing | null = /front|vorder|selfie|user/i.test(label)
    ? 'user'
    : /back|rück|rueck|rear|environment/i.test(label)
      ? 'environment'
      : null
  const lens: Lens = /ultra/i.test(label) ? 'ultra' : /tele/i.test(label) ? 'tele' : 'wide'
  return { facing, lens, virtual: /dual|triple/i.test(label) }
}

/** Alle Kameras mit Namen (Namen gibt es erst nach erteilter Erlaubnis). */
export async function listCameras(): Promise<CameraDevice[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return []
  const devices = await navigator.mediaDevices.enumerateDevices()
  return devices
    .filter((d) => d.kind === 'videoinput' && d.label)
    .map((d) => ({ id: d.deviceId, label: d.label, ...classifyCamera(d.label) }))
}

const LENS_ORDER: Lens[] = ['ultra', 'wide', 'tele']

/** Einzelne (nicht virtuelle) Objektive einer Seite, je Typ eins, sortiert weit → tele. */
export function lensesFor(devices: CameraDevice[], facing: Facing): CameraDevice[] {
  const byLens = new Map<Lens, CameraDevice>()
  for (const d of devices) {
    if (d.facing === facing && !d.virtual && !byLens.has(d.lens)) byLens.set(d.lens, d)
  }
  return LENS_ORDER.flatMap((l) => byLens.get(l) ?? [])
}

// ---------------------------------------------------------------------------
// Berechtigung

export type PermissionHint = 'granted' | 'prompt' | 'denied' | 'unknown'

/**
 * Status von Kamera + Mikrofon, ohne nachzufragen. Safari steht standardmäßig
 * auf „Fragen“ und meldet dann nach jedem Neuladen wieder „prompt“.
 */
export async function cameraPermission(): Promise<PermissionHint> {
  try {
    const names = ['camera', 'microphone'] as PermissionName[]
    const states = await Promise.all(names.map((name) => navigator.permissions.query({ name })))
    if (states.some((s) => s.state === 'denied')) return 'denied'
    if (states.every((s) => s.state === 'granted')) return 'granted'
    return 'prompt'
  } catch {
    return 'unknown'
  }
}
