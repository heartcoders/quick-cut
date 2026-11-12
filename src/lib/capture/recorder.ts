export interface RecordingResult {
  blob: Blob
  /** Gemessene Dauer in Sekunden (Fallback, falls der Container keine liefert). */
  elapsed: number
}

export interface ActiveRecording {
  readonly startedAt: number // performance.now()
  stop(): Promise<RecordingResult>
}

/** Startet eine Aufnahme mit regelmäßigen Chunks (alle 250 ms). */
export function startRecording(stream: MediaStream, mimeType?: string): ActiveRecording {
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
  const chunks: Blob[] = []
  const startedAt = performance.now()
  let stopPromise: Promise<RecordingResult> | null = null

  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data)
  }

  const done = new Promise<RecordingResult>((resolve, reject) => {
    recorder.onstop = () => {
      const type = recorder.mimeType || mimeType || chunks[0]?.type || 'video/mp4'
      resolve({ blob: new Blob(chunks, { type }), elapsed: (performance.now() - startedAt) / 1000 })
    }
    recorder.onerror = (e) => reject((e as ErrorEvent).error ?? new Error('MediaRecorder-Fehler'))
  })

  recorder.start(250)

  return {
    startedAt,
    stop() {
      stopPromise ??= (() => {
        if (recorder.state !== 'inactive') {
          recorder.stop()
        }
        return done
      })()
      return stopPromise
    },
  }
}
