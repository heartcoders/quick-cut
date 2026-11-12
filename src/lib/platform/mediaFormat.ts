/** Reihenfolge laut Handover: MP4 bevorzugt (iOS-Fotos), dann WebM. */
export const RECORDER_MIME_CANDIDATES = [
  'video/mp4;codecs=avc1,mp4a',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm',
] as const

function defaultIsSupported(type: string): boolean {
  return typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type)
}

/**
 * Erstes unterstütztes Format. `undefined` heißt: Browser wählt selbst
 * (MediaRecorder ohne mimeType-Option).
 */
export function pickRecorderMimeType(
  isSupported: (type: string) => boolean = defaultIsSupported,
): string | undefined {
  return RECORDER_MIME_CANDIDATES.find((t) => isSupported(t))
}

/** `video/mp4;codecs=…` → `video/mp4` */
export function baseMime(mime: string): string {
  return mime.split(';')[0]!.trim().toLowerCase()
}

export function extensionFor(mime: string): 'mp4' | 'webm' | 'mov' {
  const base = baseMime(mime)
  if (base === 'video/webm') return 'webm'
  if (base === 'video/quicktime') return 'mov'
  return 'mp4'
}
