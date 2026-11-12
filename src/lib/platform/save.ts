import { baseMime, extensionFor } from './mediaFormat'

const pad = (n: number) => String(n).padStart(2, '0')

export function exportFileName(date: Date, mime: string): string {
  const d = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  const t = `${pad(date.getHours())}${pad(date.getMinutes())}`
  return `quickcut-${d}-${t}.${extensionFor(mime)}`
}

export function toFile(blob: Blob, mime: string, date = new Date()): File {
  return new File([blob], exportFileName(date, mime), { type: baseMime(mime) || 'video/mp4' })
}

/** Kann das Gerät Dateien über das Share Sheet teilen (iOS → „Video sichern“)? */
export function canShareFile(file: File): boolean {
  try {
    return typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })
  } catch {
    return false
  }
}

export type SaveOutcome = 'shared' | 'downloaded' | 'cancelled'

/** Muss direkt aus einem Tap aufgerufen werden (navigator.share verlangt eine Geste). */
export async function saveVideo(file: File): Promise<SaveOutcome> {
  if (canShareFile(file)) {
    try {
      await navigator.share({ files: [file] })
      return 'shared'
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled'
      throw err
    }
  }
  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url
  a.download = file.name
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return 'downloaded'
}

/** iPhone/iPad (inkl. iPadOS, das sich als Mac ausgibt). */
export function isIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}
