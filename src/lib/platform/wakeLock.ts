/** Hält den Bildschirm während des Exports wach, wo unterstützt. Gibt eine Freigabe-Funktion zurück. */
export async function acquireWakeLock(): Promise<() => void> {
  if (!('wakeLock' in navigator)) return () => {}
  let sentinel: WakeLockSentinel | null = null
  try {
    sentinel = await navigator.wakeLock.request('screen')
  } catch {
    return () => {}
  }
  return () => void sentinel?.release().catch(() => {})
}
