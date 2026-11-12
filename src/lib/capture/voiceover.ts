import { pickAudioRecorderMimeType } from '../platform/mediaFormat'

export interface VoiceoverSession {
  /** performance.now() beim tatsächlichen Start der Aufnahme */
  readonly startedAt: number
  readonly mimeType: string
  /** Aufnahme beenden, Mikrofon freigeben, Ergebnis liefern. */
  stop(): Promise<Blob>
  /** Verwerfen (z. B. bei Abbruch), Mikrofon freigeben. */
  cancel(): void
}

/**
 * Startet eine Mikrofon-Aufnahme. Löst auf, sobald der Recorder wirklich
 * läuft (Event „start“), damit sich die Aufnahme zur Wiedergabe ausrichten lässt.
 */
export async function startVoiceover(): Promise<VoiceoverSession> {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    throw new Error('Das Mikrofon ist hier nicht verfügbar (HTTPS nötig).')
  }
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    })
  } catch (err) {
    const name = (err as DOMException)?.name
    throw new Error(
      name === 'NotAllowedError' ? 'Bitte den Zugriff aufs Mikrofon erlauben.' : 'Das Mikrofon konnte nicht gestartet werden.',
    )
  }
  const release = () => stream.getTracks().forEach((t) => t.stop())

  const mime = pickAudioRecorderMimeType()
  let recorder: MediaRecorder
  try {
    recorder = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 128_000 } : undefined)
  } catch (err) {
    release()
    throw err
  }
  const chunks: Blob[] = []
  recorder.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data)

  const startedAt = await new Promise<number>((resolve, reject) => {
    recorder.onstart = () => resolve(performance.now())
    recorder.onerror = (e) => reject((e as ErrorEvent).error ?? new Error('Aufnahme fehlgeschlagen'))
    recorder.start(500)
  }).catch((err) => {
    release()
    throw err
  })
  const mimeType = recorder.mimeType || mime || 'audio/mp4'

  return {
    startedAt,
    mimeType,
    stop() {
      return new Promise<Blob>((resolve) => {
        if (recorder.state === 'inactive') {
          release()
          return resolve(new Blob(chunks, { type: mimeType }))
        }
        recorder.onstop = () => {
          release()
          resolve(new Blob(chunks, { type: mimeType }))
        }
        recorder.stop()
      })
    },
    cancel() {
      recorder.onstop = null
      if (recorder.state !== 'inactive') recorder.stop()
      release()
    },
  }
}
