/**
 * Führt Jobs strikt nacheinander aus. Thumbnails werden so seriell erzeugt,
 * damit schwache Geräte nicht ruckeln. Ein fehlschlagender Job blockiert
 * die folgenden nicht.
 */
export class SerialQueue {
  #tail: Promise<void> = Promise.resolve()
  #pending = 0

  get pending(): number {
    return this.#pending
  }

  enqueue<T>(job: () => Promise<T>): Promise<T> {
    this.#pending++
    const result = this.#tail.then(job).finally(() => {
      this.#pending--
    })
    this.#tail = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }
}

export const mediaQueue = new SerialQueue()
