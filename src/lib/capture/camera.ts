export type Facing = 'user' | 'environment'
export type CameraErrorKind = 'insecure' | 'denied' | 'notfound' | 'busy' | 'other'

export class CameraError extends Error {
  constructor(
    readonly kind: CameraErrorKind,
    cause?: unknown,
  ) {
    super(`Kamera nicht verfügbar: ${kind}`, { cause })
  }
}

function videoConstraints(facing: Facing): MediaTrackConstraints {
  return { facingMode: facing, width: { ideal: 1080 }, height: { ideal: 1920 } }
}

function classify(err: unknown): CameraErrorKind {
  const name = err instanceof DOMException ? err.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied'
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'notfound'
  if (name === 'NotReadableError' || name === 'AbortError') return 'busy'
  return 'other'
}

/** Öffnet Kamera + Mikrofon. Ohne Mikrofon wird nur Video angefordert. */
export async function openCamera(facing: Facing): Promise<MediaStream> {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    throw new CameraError('insecure')
  }
  try {
    return await navigator.mediaDevices.getUserMedia({ video: videoConstraints(facing), audio: true })
  } catch (err) {
    // Kein Mikrofon vorhanden → wenigstens Video.
    if (err instanceof DOMException && err.name === 'NotFoundError') {
      try {
        return await navigator.mediaDevices.getUserMedia({ video: videoConstraints(facing), audio: false })
      } catch (err2) {
        throw new CameraError(classify(err2), err2)
      }
    }
    throw new CameraError(classify(err), err)
  }
}

/** Stoppt alle Tracks, sonst bleibt die Kamera-LED an. */
export function stopStream(stream: MediaStream | null | undefined): void {
  stream?.getTracks().forEach((t) => t.stop())
}

export function isStreamLive(stream: MediaStream | null | undefined): boolean {
  return !!stream && stream.getVideoTracks().some((t) => t.readyState === 'live')
}
