<script module lang="ts">
  // Einmal pro Seitenaufruf: Kehrt man aus dem Schnitt zurück, nicht erneut fragen.
  let cameraStarted = false
</script>

<script lang="ts">
  import { onMount, untrack } from 'svelte'
  import {
    CameraError,
    cameraPermission,
    clampZoom,
    currentZoom,
    dragToZoom,
    isStreamLive,
    lensesFor,
    listCameras,
    openCamera,
    setZoom,
    stopStream,
    zoomRange,
    type CameraDevice,
    type CameraErrorKind,
    type Facing,
    type Lens,
  } from '../lib/capture/camera'
  import RecordButton from '../lib/capture/RecordButton.svelte'
  import { startRecording, type ActiveRecording } from '../lib/capture/recorder'
  import { importFiles } from '../lib/import/importFiles'
  import { ingestBlob } from '../lib/media/pipeline'
  import { pickRecorderMimeType } from '../lib/platform/mediaFormat'
  import { createDevClip } from '../lib/project/devClip'
  import { store } from '../lib/project/store.svelte'
  import { router } from '../lib/router.svelte'
  import ClipStrip from '../ui/ClipStrip.svelte'
  import { outputSize } from '../lib/renderer/geometry'

  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
  const ALLOW_HINT = isIOS
    ? 'In Safari links in der Adressleiste auf „aA“ → Website-Einstellungen → Kamera und Mikrofon auf „Erlauben“ stellen.'
    : 'In den Website-Einstellungen des Browsers Kamera und Mikrofon dauerhaft erlauben.'

  const ERROR_TEXT: Record<CameraErrorKind, string> = {
    insecure: 'Kamera braucht HTTPS. Bitte die App über https:// öffnen.',
    denied: `Kein Zugriff auf Kamera/Mikrofon. ${ALLOW_HINT}`,
    notfound: 'Keine passende Kamera gefunden.',
    busy: 'Die Kamera wird gerade von einer anderen App benutzt.',
    other: 'Kamera konnte nicht gestartet werden.',
  }

  // Vorne ist Ultraweit das Bildfeld der iOS-Kamera-App – dort heißt es „1×“.
  const LENS_LABEL: Record<Facing, Record<Lens, string>> = {
    user: { ultra: '1×', wide: '2×', tele: 'Tele' },
    environment: { ultra: '0.5×', wide: '1×', tele: 'Tele' },
  }
  const DEFAULT_LENS: Record<Facing, Lens> = { user: 'ultra', environment: 'wide' }
  /** Bildwinkel je Objektiv in der Sprache der Chips (für die Zoom-Anzeige). */
  const LENS_BASE: Record<Facing, Partial<Record<Lens, number>>> = {
    user: { ultra: 1, wide: 2 },
    environment: { ultra: 0.5, wide: 1 },
  }
  const LENSES: Lens[] = ['ultra', 'wide', 'tele']

  // Zuletzt gewählte Kamera merken, Objektiv je Seite.
  const PREF_KEY = 'quick-cut.camera'
  function loadPref(): { facing: Facing; lenses: Record<Facing, Lens> } {
    try {
      const p = JSON.parse(localStorage.getItem(PREF_KEY) ?? '{}')
      const pick = (f: Facing): Lens => (LENSES.includes(p.lenses?.[f]) ? p.lenses[f] : DEFAULT_LENS[f])
      return {
        facing: p.facing === 'environment' ? 'environment' : 'user',
        lenses: { user: pick('user'), environment: pick('environment') },
      }
    } catch {
      return { facing: 'user', lenses: { ...DEFAULT_LENS } }
    }
  }
  const pref = loadPref()

  let facing = $state<Facing>(pref.facing)
  let lensBy = $state<Record<Facing, Lens>>(pref.lenses)
  const lens = $derived(lensBy[facing])
  let cameras = $state<CameraDevice[]>([])
  let started = $state(cameraStarted) // false → erst Hinweis zeigen, nicht sofort fragen
  let stream = $state<MediaStream | null>(null)
  let cameraError = $state<CameraErrorKind | null>(null)
  let reopen = $state(0) // erhöhen → Kamera neu öffnen
  let videoEl: HTMLVideoElement | undefined = $state()
  let recording: ActiveRecording | null = null
  let isRecording = $state(false)
  let fileInput: HTMLInputElement | undefined = $state()
  /** Mikrofon zwischen zwei Kameras: wird beim Wechsel weiterverwendet. */
  let spareAudio: MediaStreamTrack | null = null
  let destroyed = false
  /** Läuft gerade das Speichern einer Aufnahme? Erst danach Kamera freigeben. */
  let saving: Promise<void> = Promise.resolve()
  // Letztes Bild beim Kamerawechsel stehen lassen statt Schwarz.
  let frozenEl: HTMLCanvasElement | undefined = $state()
  let frozen = $state(false)
  let frozenMirror = $state(false)
  // Zoom
  let zoom = $state<number | null>(null)
  let zoomVisible = $state(false)
  let zoomTarget: number | null = null
  let zoomRaf = 0
  let zoomHideTimer = 0
  let dragFrom: number | null = null
  const pointers = new Map<number, { x: number; y: number }>()
  let pinch: { dist: number; zoom: number } | null = null

  const lenses = $derived(lensesFor(cameras, facing))
  const activeLens = $derived.by((): Lens => {
    for (const want of [lens, DEFAULT_LENS[facing]]) if (lenses.some((l) => l.lens === want)) return want
    return lenses[0]?.lens ?? 'wide'
  })
  // Spiegeln nach tatsächlicher Kamera, nicht nach Wunsch (Fallbacks).
  const mirror = $derived((stream?.getVideoTracks()[0]?.getSettings().facingMode ?? facing) === 'user')
  const range = $derived(zoomRange(stream))
  const zoomLabel = $derived.by(() => {
    if (zoom === null || !range) return ''
    // Nur ein Objektiv auf der Seite → das ist „1×“.
    const base = lenses.length > 1 ? (LENS_BASE[facing][activeLens] ?? 1) : 1
    const v = (base * zoom) / range.min
    return `${v < 10 ? v.toFixed(1).replace(/\.0$/, '') : Math.round(v)}×`
  })

  const mimeType = pickRecorderMimeType()
  // Vorschau im Zielformat zeigen: was man sieht, landet (mittig) im Video.
  const out = $derived(outputSize(store.project.outputAspect))
  const debug = new URLSearchParams(location.search).has('debug')
  const camInfo = $derived.by(() => {
    const track = stream?.getVideoTracks()[0]
    if (!track) return ''
    const s = track.getSettings() as MediaTrackSettings & { zoom?: number; focusMode?: string; focusDistance?: number }
    const c = (track.getCapabilities?.() ?? {}) as MediaTrackCapabilities & {
      zoom?: { min?: number; max?: number }
      focusMode?: string[]
      focusDistance?: { min?: number; max?: number }
    }
    const ratio = s.width && s.height ? (Math.max(s.width, s.height) / Math.min(s.width, s.height)).toFixed(2) : '?'
    return [
      `${track.label}`,
      `${s.width}×${s.height} (${ratio}) → ${out.width}×${out.height}`,
      `focus ${s.focusMode ?? '–'} [${c.focusMode?.join(',') ?? 'n/a'}] · dist ${s.focusDistance ?? '–'} (${c.focusDistance ? `${c.focusDistance.min}–${c.focusDistance.max}` : 'n/a'})`,
      `facing ${s.facingMode ?? '?'} · zoom ${s.zoom ?? '–'} (${c.zoom ? `${c.zoom.min}–${c.zoom.max}` : 'n/a'})`,
      `max ${c.width?.max ?? '?'}×${c.height?.max ?? '?'}`,
      ...cameras.map((d) => `${d.id === s.deviceId ? '▸' : '·'} ${d.label} [${d.facing ?? '?'}/${d.lens}${d.virtual ? '/virt' : ''}]`),
    ].join('\n')
  })

  async function refreshCameras(): Promise<CameraDevice[]> {
    try {
      cameras = await listCameras()
    } catch {
      // Ohne Liste gibt es eben keine Objektivwahl.
    }
    return cameras
  }

  function start() {
    started = true
    reopen++
  }

  $effect(() => {
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify({ facing, lenses: lensBy }))
    } catch {
      // Privater Modus o. Ä. – dann ohne Merken.
    }
  })

  // Kamera öffnen, wenn Seite/Objektiv wechselt oder neu angefordert wird.
  $effect(() => {
    if (!started) return
    void reopen
    const want = facing
    const wantLens = lens
    const deviceId = untrack(() => lensesFor(cameras, want).find((d) => d.lens === wantLens)?.id)
    const audio = spareAudio ?? undefined
    spareAudio = null
    let cancelled = false
    let opened: MediaStream | null = null
    cameraError = null
    openCamera({ facing: want, deviceId, audio })
      .then(async (s) => {
        if (cancelled) return stopStream(s)
        opened = s
        stream = s
        cameraStarted = true
        // Gerätenamen gibt es erst jetzt. Lief die Kamera noch ohne Objektivwahl,
        // einmal auf das gewünschte Objektiv umschalten.
        const list = await refreshCameras()
        if (cancelled || deviceId) return
        const target = lensesFor(list, want).find((d) => d.lens === wantLens)
        const current = s.getVideoTracks()[0]?.getSettings().deviceId
        if (target && current && target.id !== current) reopen++
      })
      .catch((err) => {
        audio?.stop()
        if (cancelled) return
        frozen = false
        cameraError = err instanceof CameraError ? err.kind : 'other'
      })
    return () => {
      cancelled = true
      if (opened && !destroyed && isStreamLive(opened)) {
        // Kamerawechsel: Bild einfrieren, Mikrofon behalten, nur Video stoppen.
        freezeFrame()
        spareAudio = opened.getAudioTracks().find((t) => t.readyState === 'live') ?? null
        opened.getVideoTracks().forEach((t) => t.stop())
      } else {
        stopStream(opened)
      }
      if (stream === opened) stream = null
    }
  })

  $effect(() => {
    if (videoEl) videoEl.srcObject = stream
  })

  $effect(() => {
    zoom = currentZoom(stream)
  })

  function freezeFrame() {
    const v = videoEl
    const c = frozenEl
    if (!v || !c || v.readyState < 2 || !v.videoWidth) return
    c.width = v.videoWidth
    c.height = v.videoHeight
    c.getContext('2d')?.drawImage(v, 0, 0)
    frozenMirror = mirror
    frozen = true
  }

  /** Kamera und Mikrofon ganz freigeben (App im Hintergrund). */
  function releaseCamera() {
    freezeFrame()
    stopStream(stream)
    stream = null
    spareAudio?.stop()
    spareAudio = null
  }

  // --- Zoom ---------------------------------------------------------------

  function showZoom() {
    zoomVisible = true
    clearTimeout(zoomHideTimer)
    zoomHideTimer = window.setTimeout(() => (zoomVisible = false), 1200)
  }

  /** Zoom anfordern; mehrere Werte pro Frame werden zu einem zusammengefasst. */
  function requestZoom(value: number) {
    if (!range) return
    zoom = clampZoom(value, range)
    zoomTarget = zoom
    showZoom()
    if (zoomRaf) return
    zoomRaf = requestAnimationFrame(() => {
      zoomRaf = 0
      const z = zoomTarget
      zoomTarget = null
      if (z !== null) void setZoom(stream, z)
    })
  }

  /** Halten und nach oben wischen (wie bei WhatsApp). */
  function onZoomDrag(progress: number) {
    if (!range) return
    dragFrom ??= zoom ?? range.min
    requestZoom(dragToZoom(progress, dragFrom, range.max))
  }

  function pinchDistance(): number {
    const [a, b] = [...pointers.values()]
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0
  }

  function onPinchDown(e: PointerEvent) {
    if (!range) return
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    if (pointers.size === 2) pinch = { dist: pinchDistance(), zoom: zoom ?? range.min }
  }

  function onPinchMove(e: PointerEvent) {
    if (!pointers.has(e.pointerId)) return
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pinch && pointers.size === 2 && pinch.dist > 0) requestZoom((pinch.zoom * pinchDistance()) / pinch.dist)
  }

  function onPinchUp(e: PointerEvent) {
    pointers.delete(e.pointerId)
    if (pointers.size < 2) pinch = null
  }

  onMount(() => {
    // Nur sofort öffnen, wenn der Browser nicht nachfragen wird.
    if (!started) {
      void cameraPermission().then((p) => {
        if (started) return
        if (p === 'granted' || p === 'unknown') start()
        else if (p === 'denied') cameraError = 'denied'
      })
    }
    // Im Hintergrund Kamera und Mikrofon freigeben (sonst bleibt der Mikrofon-Punkt an),
    // beim Zurückkehren neu öffnen. Eine laufende Aufnahme beendet der RecordButton
    // vorher selbst; erst wenn sie gespeichert ist, wird freigegeben.
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        void saving.then(() => {
          if (document.visibilityState === 'hidden') releaseCamera()
        })
      } else if (started && !isStreamLive(stream)) {
        reopen++
      }
    }
    const onPageHide = () => void saving.then(releaseCamera)
    const onDeviceChange = () => void refreshCameras()
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', onPageHide)
    window.addEventListener('pageshow', onVisibility)
    navigator.mediaDevices?.addEventListener?.('devicechange', onDeviceChange)
    return () => {
      destroyed = true
      spareAudio?.stop()
      spareAudio = null
      clearTimeout(zoomHideTimer)
      cancelAnimationFrame(zoomRaf)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', onPageHide)
      window.removeEventListener('pageshow', onVisibility)
      navigator.mediaDevices?.removeEventListener?.('devicechange', onDeviceChange)
    }
  })

  function handleStart(): boolean {
    if (!stream || !isStreamLive(stream)) return false
    recording = startRecording(stream, mimeType)
    isRecording = true
    dragFrom = null
    return true
  }

  function handleStop(): Promise<void> {
    const rec = recording
    recording = null
    isRecording = false
    // Zoom per Wischen gilt nur für diese Aufnahme.
    if (dragFrom !== null) requestZoom(dragFrom)
    dragFrom = null
    if (!rec) return saving
    saving = (async () => {
      try {
        const { blob, elapsed } = await rec.stop()
        if (blob.size > 0) await ingestBlob(blob, 'recorded', { fallbackDuration: elapsed })
      } catch (err) {
        console.error('Aufnahme konnte nicht gespeichert werden', err)
      }
    })()
    return saving
  }

  function onFilesChosen(e: Event) {
    const input = e.currentTarget as HTMLInputElement
    const files = Array.from(input.files ?? [])
    input.value = '' // dieselbe Datei erneut wählbar
    if (files.length) void importFiles(files)
  }

  function flip() {
    facing = facing === 'user' ? 'environment' : 'user'
  }

  async function addTestClip() {
    const { record, thumbUrl } = await createDevClip()
    store.addClip(record, 'ready', [thumbUrl])
  }
</script>

<section class="record">
  <!-- svelte-ignore a11y_media_has_caption -->
  <video
    bind:this={videoEl}
    class="preview"
    autoplay
    playsinline
    muted
    class:mirror={mirror}
    style:--ar={out.width / out.height}
    onplaying={() => (frozen = false)}
  ></video>
  <canvas
    bind:this={frozenEl}
    class="preview frozen"
    class:mirror={frozenMirror}
    hidden={!frozen}
    style:--ar={out.width / out.height}
  ></canvas>
  <!-- Zwei-Finger-Zoom auf der Vorschau, auch während der Aufnahme. -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="gesture"
    onpointerdown={onPinchDown}
    onpointermove={onPinchMove}
    onpointerup={onPinchUp}
    onpointercancel={onPinchUp}
  ></div>
  {#if zoomVisible && zoomLabel}
    <div class="zoom">{zoomLabel}</div>
  {/if}
  {#if debug && camInfo}
    <div class="debug">{camInfo}</div>
  {/if}

  {#if cameraError}
    <div class="error">
      <p>{ERROR_TEXT[cameraError]}</p>
      <button onclick={start}>Erneut versuchen</button>
    </div>
  {/if}

  <header>
    {#if import.meta.env.DEV}
      <button class="small" onclick={addTestClip} disabled={isRecording}>+ Test</button>
    {:else}
      <span></span>
    {/if}
    <button class="round" onclick={flip} disabled={isRecording} aria-label="Kamera wechseln">⟲</button>
  </header>

  {#if !started && !cameraError}
    <div class="intro">
      <p>Für die Aufnahme braucht Quick Cut Kamera und Mikrofon.</p>
      <button class="primary" onclick={start}>Kamera starten</button>
      <p class="hint">Damit nicht bei jedem Öffnen gefragt wird: {ALLOW_HINT}</p>
    </div>
  {/if}

  <footer>
    {#if lenses.length > 1}
      <div class="lenses" role="group" aria-label="Objektiv">
        {#each lenses as l (l.id)}
          <button
            class:active={l.lens === activeLens}
            disabled={isRecording}
            aria-pressed={l.lens === activeLens}
            onclick={() => (lensBy[facing] = l.lens)}>{LENS_LABEL[facing][l.lens]}</button
          >
        {/each}
      </div>
    {/if}
    {#if store.hasClips}
      <ClipStrip removable={!isRecording} reorderable={!isRecording} />
    {/if}
    <div class="controls">
      <button
        class="side"
        disabled={isRecording}
        onclick={() => fileInput?.click()}
        aria-label="Aus Galerie importieren">▦</button
      >
      <input bind:this={fileInput} type="file" accept="video/*" multiple hidden onchange={onFilesChosen} />
      <RecordButton disabled={!stream} onstart={handleStart} onstop={handleStop} onzoomdrag={onZoomDrag} />
      <button
        class="side primary"
        disabled={!store.hasPlayableClips || isRecording}
        onclick={() => router.go('cut')}>Weiter</button
      >
    </div>
  </footer>
</section>

<style>
  .record {
    position: relative;
    height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    overflow: hidden;
  }
  /* Rahmen im Ausgabeformat, mittig; object-fit: cover = derselbe Zuschnitt wie der Renderer. */
  .preview {
    position: fixed;
    top: 50%;
    left: 50%;
    width: min(100vw, 100dvh * var(--ar));
    aspect-ratio: var(--ar);
    transform: translate(-50%, -50%);
    object-fit: cover;
    background: #000;
    z-index: 0;
  }
  /* Frontkamera nur in der Vorschau spiegeln, nicht in der Aufnahme. */
  .preview.mirror {
    transform: translate(-50%, -50%) scaleX(-1);
  }
  .frozen {
    filter: blur(10px) brightness(0.8);
  }
  .frozen[hidden] {
    display: none;
  }
  .gesture {
    position: fixed;
    inset: 0;
    z-index: 0;
    touch-action: none;
  }
  .zoom {
    position: fixed;
    top: 4.5rem;
    left: 50%;
    transform: translateX(-50%);
    z-index: 1;
    padding: 2px 12px;
    border-radius: 999px;
    background: rgba(0, 0, 0, 0.55);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    pointer-events: none;
  }
  .debug {
    position: fixed;
    top: 4rem;
    left: 0.75rem;
    z-index: 1;
    font: 11px/1.3 ui-monospace, monospace;
    color: #0f0;
    background: rgba(0, 0, 0, 0.7);
    padding: 2px 6px;
    border-radius: 4px;
    white-space: pre;
    max-width: calc(100vw - 1.5rem);
    overflow: hidden;
  }
  .intro {
    position: relative;
    z-index: 1;
    display: grid;
    justify-items: center;
    gap: 1rem;
    margin: 0 1.5rem;
    padding: 1.5rem;
    text-align: center;
    border-radius: 16px;
    background: rgba(20, 20, 20, 0.85);
  }
  .intro .hint {
    margin: 0;
    font-size: 0.8rem;
    opacity: 0.7;
  }
  .lenses {
    display: flex;
    justify-content: center;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
  }
  .lenses button {
    min-width: 44px;
    min-height: 36px;
    padding: 0 0.6rem;
    border-radius: 18px;
    font-size: 0.8rem;
    background: rgba(40, 40, 40, 0.6);
  }
  .lenses button.active {
    color: var(--accent);
    font-weight: 600;
  }
  header,
  footer {
    position: relative;
    z-index: 1;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.75rem;
  }
  footer {
    padding: 0 0.75rem 1rem;
    background: linear-gradient(transparent, rgba(0, 0, 0, 0.55));
  }
  .controls {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    margin-top: 1rem;
  }
  .side {
    justify-self: center;
    min-width: 64px;
    background: rgba(40, 40, 40, 0.7);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
  }
  .side.primary {
    background: var(--accent);
  }
  .round {
    width: 44px;
    height: 44px;
    padding: 0;
    border-radius: 50%;
    font-size: 1.3rem;
    background: rgba(40, 40, 40, 0.6);
  }
  .small {
    font-size: 0.8rem;
    padding: 0.3rem 0.7rem;
    min-height: 32px;
    background: rgba(40, 40, 40, 0.6);
  }
  .error {
    position: absolute;
    inset: 0;
    z-index: 2;
    display: grid;
    place-content: center;
    gap: 1rem;
    padding: 2rem;
    text-align: center;
    background: rgba(0, 0, 0, 0.85);
  }
</style>
