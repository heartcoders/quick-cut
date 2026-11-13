<script lang="ts">
  import { onMount } from 'svelte'
  import { startRender, type RenderJob } from '../lib/export/exportV1'
  import { startVoiceover, type VoiceoverSession } from '../lib/capture/voiceover'
  import { buildAudioTracks, buildRenderClips, plainTransitions } from '../lib/export/renderInput'
  import { getClipAudio } from '../lib/media/clipAudio'
  import { getClipUrl } from '../lib/media/clipUrls'
  import { playRange } from '../lib/media/rangePlayer'
  import { createSeeker, type Seeker } from '../lib/media/seeker'
  import { store } from '../lib/project/store.svelte'
  import { AudioGraph } from '../lib/renderer/audioGraph'
  import { createRenderer } from '../lib/renderer/createRenderer'
  import { withFaces } from '../lib/faces/place'
  import { facesOn } from '../lib/faces/settings'
  import { isNeutral, normalizeLook } from '../lib/renderer/looks'
  import type { RenderClip, Renderer } from '../lib/renderer/types'
  import { router } from '../lib/router.svelte'
  import { scheduleTimelineAudio } from '../lib/timeline/audioSchedule'
  import { clipStartTimes, effectiveDurations, type Handle } from '../lib/timeline/timeline'
  import { SequencePlayer } from '../lib/media/sequencePlayer'
  import AspectPicker from '../ui/AspectPicker.svelte'
  import AudioSheet from '../ui/AudioSheet.svelte'
  import ClipStrip from '../ui/ClipStrip.svelte'
  import CropFrame from '../ui/CropFrame.svelte'
  import FaceSheet from '../ui/FaceSheet.svelte'
  import LookSheet from '../ui/LookSheet.svelte'
  import SourceVideos from '../ui/SourceVideos.svelte'
  import { formatPrecise } from '../ui/format'
  import Screen from '../ui/Screen.svelte'
  import TransitionSheet from '../ui/TransitionSheet.svelte'
  import TrimEditor from '../ui/TrimEditor.svelte'
  import { toasts } from '../ui/toast.svelte'

  type Mode = 'idle' | 'clip' | 'all'

  let selectedId = $state<string | null>(null)
  let mode = $state<Mode>('idle')
  let playhead = $state(0) // lokale Zeit im gewählten Clip
  let allTime = $state(0) // Gesamtzeit bei „Alles abspielen“
  let canvasReady = $state(false) // erster Frame im Canvas → Einzelvorschau ausblenden
  let urls = $state<Record<string, string>>({})
  let renderClips = $state.raw<RenderClip[]>([])
  let sheetIndex = $state<number | null>(null)
  let previewingTransition = $state(false)
  let lookOpen = $state(false)
  let facesOpen = $state(false)
  let audioOpen = $state(false)
  /** Voiceover-Aufnahme: idle → starting (Mikrofon) → recording → saving */
  let voState = $state<'idle' | 'starting' | 'recording' | 'saving'>('idle')
  let voSession: VoiceoverSession | null = null
  let voFirstFrame: number | null = null // performance.now() beim ersten gezeichneten Bild
  /** Bereits dekodierter Clip-Ton (für die Einzelvorschau mit Lautstärke < 100 %). */
  const decoded = new Map<string, AudioBuffer>()
  let playingId = $state<string | null>(null) // Clip, der bei „Alles“ gerade läuft
  const debug = new URLSearchParams(location.search).has('debug')
  let debugText = $state('')

  let single: HTMLVideoElement | undefined = $state()
  let videoA: HTMLVideoElement | undefined = $state()
  let videoB: HTMLVideoElement | undefined = $state()
  let stage: HTMLDivElement | undefined = $state()
  let lookStage: HTMLDivElement | undefined = $state()
  /** Eigener Renderer für die Einzelvorschau mit Look (ganzes Bild, Videogröße). */
  let lookRenderer: Renderer | null = null
  let lookDrawn = $state(false) // erstes Bild mit Look liegt im Canvas → Video ausblenden
  let seeker: Seeker | null = null
  let renderer = $state.raw<Renderer | null>(null)
  let audio: AudioGraph | null = null
  let job: RenderJob | null = null
  let stopRange: (() => void) | null = null

  const clips = $derived(store.playableClips)
  const clip = $derived(clips.find((c) => c.id === selectedId) ?? clips[0])
  const clipUrl = $derived(clip ? urls[clip.blobKey] : undefined)
  /** Gesichter-Effekt des gewählten Clips (nur wenn aktiv und Gesichter erkannt). */
  const clipFaceFx = $derived(clip ? renderClips.find((r) => r.blobKey === clip.blobKey)?.faceFx : undefined)
  /** Einzelvorschau über den Renderer: bei Look oder Gesichter-Effekt. */
  const lookActive = $derived(!!clip && (!isNeutral(clip.look) || !!clipFaceFx))
  const hasSoundEdits = $derived(
    (clip?.volume ?? 1) < 1 || !!store.project.music || !!store.project.voiceover,
  )

  // Object-URLs aller Clips vorab auflösen: „Alles abspielen“ braucht sie synchron im Tap.
  $effect(() => {
    for (const c of clips) {
      if (urls[c.blobKey]) continue
      void getClipUrl(c).then((u) => {
        if (u) urls[c.blobKey] = u
      })
    }
  })

  let renderClipIds: string[] = []
  let stillReady = false // erstes Bild liegt bereits im Canvas

  // Im Leerlauf das erste Bild der Timeline ins Canvas rendern: „Alles“ kann es
  // dann sofort zeigen, ohne kurz den gerade gewählten Clip aufblitzen zu lassen.
  $effect(() => {
    const r = renderer
    const rc = renderClips
    const tr = plainTransitions(store.playableTransitions)
    const aspect = store.project.outputAspect
    if (!r || rc.length === 0 || mode !== 'idle') return
    stillReady = false
    let cancelled = false
    void r
      .load({ clips: rc, transitions: tr, outputAspect: aspect })
      .then(() => (mode === 'idle' && !cancelled ? r.renderFrame(0) : undefined))
      .then(() => {
        if (!cancelled && mode === 'idle') stillReady = true
      })
    return () => (cancelled = true)
  })

  // Renderer-Eingaben aktuell halten (Trim, Reihenfolge, URLs).
  $effect(() => {
    let cancelled = false
    const ids = clips.map((c) => c.id)
    void buildRenderClips(clips).then((r) => {
      if (cancelled) return
      renderClips = r
      renderClipIds = ids
      // Ton vorab dekodieren, damit er beim Tippen auf „Alles“ schon bereitliegt.
      for (const c of r) {
        void getClipAudio(c.blobKey).then((b) => {
          if (b && c.blobKey) decoded.set(c.blobKey, b)
        })
      }
    })
    return () => (cancelled = true)
  })

  // Musik und Voiceover vorab dekodieren, damit „Alles“ sofort mit Ton startet.
  $effect(() => {
    const keys = [store.project.music?.blobKey, store.project.voiceover?.blobKey]
    for (const k of keys) if (k) void getClipAudio(k)
  })

  // Clipwechsel: Wiedergabe stoppen, Playhead an den Anfang.
  $effect(() => {
    const id = clip?.id
    if (!id) return
    stopAll()
    playhead = clip.trimStart
  })

  // Vorschau auf den Playhead setzen, sobald das Video geladen ist.
  $effect(() => {
    if (!single || !clipUrl) return
    const el = single
    const t = clip?.trimStart ?? 0
    const onMeta = () => seeker?.request(t)
    el.addEventListener('loadedmetadata', onMeta, { once: true })
    return () => el.removeEventListener('loadedmetadata', onMeta)
  })

  // Einzelvorschau mit Look: Der Clip-Modus zeigt das ganze Quellbild (mit
  // Ausschnittsrahmen darüber), deshalb zeichnet ein eigener Renderer in
  // Videogröße. Neu gezeichnet wird nur, wenn sich das Bild ändert.
  const LOOK_PREVIEW_EDGE = 1280
  $effect(() => {
    const el = single
    const look = normalizeLook(clip?.look)
    if (!lookActive || !el || !lookStage) {
      lookDrawn = false
      return
    }
    if (!lookRenderer) {
      try {
        lookRenderer = createRenderer()
        lookRenderer.canvas.classList.add('stage-canvas')
        lookStage.append(lookRenderer.canvas)
      } catch (err) {
        console.error('Look-Vorschau nicht verfügbar', err)
        return
      }
    }
    const r = lookRenderer
    const place = { rotation: 0, panX: 0.5, panY: 0.5, look, faceFx: clipFaceFx }
    let last = -1
    let raf = 0
    const tick = () => {
      if (el.readyState >= 2 && el.videoWidth > 0 && el.currentTime !== last) {
        const k = Math.min(1, LOOK_PREVIEW_EDGE / Math.max(el.videoWidth, el.videoHeight))
        r.setSize(Math.round(el.videoWidth * k), Math.round(el.videoHeight * k))
        r.setTime(el.currentTime)
        r.drawVideo(el, withFaces(place, el.currentTime))
        last = el.currentTime
        lookDrawn = true
      }
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  })

  onMount(() => {
    if (single) seeker = createSeeker(single)
    try {
      renderer = createRenderer()
      renderer.canvas.classList.add('stage-canvas')
      stage?.append(renderer.canvas)
    } catch (err) {
      console.error('Renderer nicht verfügbar', err)
    }
    // Voiceover im Hintergrund beenden und speichern, sonst bleibt das Mikrofon an.
    const onHidden = () => {
      if (document.visibilityState === 'hidden' && voState === 'recording') void finishVoice()
    }
    document.addEventListener('visibilitychange', onHidden)
    window.addEventListener('pagehide', onHidden)
    return () => {
      document.removeEventListener('visibilitychange', onHidden)
      window.removeEventListener('pagehide', onHidden)
      stopAll()
      seeker?.dispose()
      renderer?.dispose()
      lookRenderer?.dispose()
      audio?.close()
      voSession?.cancel()
      voSession = null
    }
  })

  function stopAll() {
    stopRange?.()
    stopRange = null
    job?.cancel()
    job = null
    canvasReady = false
    previewingTransition = false
    playingId = null
    mode = 'idle'
  }

  /**
   * Wiedergabe über den Renderer – dieselbe Pipeline wie der Export, damit
   * Übergänge in der Vorschau exakt so aussehen wie im fertigen Video.
   * Muss synchron im Tap laufen (iOS).
   */
  function playRendered(
    range?: { from: number; to: number },
    opts: { silent?: boolean; onReady?: () => void; onEnd?: () => void } = {},
  ) {
    if (!renderer || !videoA || !videoB || renderClips.length === 0) return false
    if (!opts.silent) audio ??= AudioGraph.tryCreate()
    allTime = range?.from ?? 0
    mode = 'all'
    // Ab Start: Canvas zeigt das vorgerenderte erste Bild (nur bei Start bei 0).
    canvasReady = !range && stillReady
    const j = startRender({
      clips: renderClips,
      transitions: plainTransitions(store.playableTransitions),
      aspect: store.project.outputAspect,
      renderer,
      videos: [videoA, videoB],
      audio: opts.silent ? null : audio,
      tracks: buildAudioTracks(store.project),
      record: false,
      fromTime: range?.from,
      toTime: range?.to,
      onProgress: (t) => (allTime = t),
      // Canvas erst zeigen, wenn Clip 1 wirklich gezeichnet ist – vorher bleibt
      // die Einzelvorschau stehen (kein Schwarzbild).
      onReady: () => {
        canvasReady = true
        opts.onReady?.()
      },
      onFrame: (f) => {
        const id = renderClipIds[f.fromIndex] ?? null
        if (id !== playingId) playingId = id
        if (debug) {
          const v = (el: HTMLVideoElement | undefined) =>
            el ? `${el.currentTime.toFixed(2)}${el.paused ? 'p' : ''}` : '-'
          debugText = `clip ${f.fromIndex + 1}${f.to ? ` → ${f.fromIndex + 2} ${f.type} p=${f.p.toFixed(2)}` : ''} | A ${v(videoA)} B ${v(videoB)} | lead ${(SequencePlayer.lead * 1000).toFixed(0)} ms`
        }
      },
    })
    job = j
    j.done
      .catch(() => {})
      .finally(() => {
        opts.onEnd?.()
        if (job !== j) return
        job = null
        mode = 'idle'
        canvasReady = false
        previewingTransition = false
      })
    return true
  }

  function select(id: string) {
    selectedId = id
  }

  function onTrim(trimStart: number, trimEnd: number, handle: Handle) {
    if (!clip) return
    store.setTrim(clip.id, trimStart, trimEnd)
    playhead = handle === 'start' ? trimStart : trimEnd
    seeker?.request(playhead)
  }

  function onSeek(t: number) {
    if (mode === 'all') stopAll()
    stopRange?.()
    stopRange = null
    if (mode === 'clip') mode = 'idle'
    playhead = t
    seeker?.request(t)
  }

  function onDragEnd() {
    // Nach dem Ziehen des Endgriffs zum Start springen, damit Play sofort passt.
    if (clip && playhead >= clip.trimEnd - 0.05) {
      playhead = clip.trimStart
      seeker?.request(playhead)
    }
  }

  function togglePlay() {
    if (!single || !clip) return
    if (mode === 'clip') return stopAll()
    stopAll()
    const from = playhead >= clip.trimStart && playhead < clip.trimEnd - 0.05 ? playhead : clip.trimStart
    mode = 'clip'
    const sound = clipSound(clip, from)
    const stopVideo = playRange(single, from, clip.trimEnd, {
      onTime: (t) => (playhead = t),
      onEnd: () => {
        sound?.stop()
        stopRange = null
        mode = 'idle'
      },
    })
    stopRange = () => {
      stopVideo()
      sound?.stop()
    }
  }

  /**
   * Ton der Einzelvorschau. Bei 100 % kommt er wie bisher aus dem <video>.
   * iOS ignoriert video.volume, deshalb bei Zwischenwerten: Video stumm und
   * Ton aus dem dekodierten Puffer über Web Audio (im Tap aufrufen).
   */
  function clipSound(c: typeof clip & {}, from: number): { stop(): void } | null {
    const el = single!
    const vol = c.volume ?? 1
    el.volume = 1
    el.muted = vol < 1
    if (vol <= 0 || vol >= 1) return null
    const buf = decoded.get(c.blobKey)
    audio ??= AudioGraph.tryCreate()
    if (!buf || !audio) {
      // Puffer noch nicht fertig: wirkt außerhalb von iOS.
      el.muted = false
      el.volume = vol
      return null
    }
    void audio.resume()
    return scheduleTimelineAudio(audio.ctx, audio.input, [{ duration: c.duration, trimStart: from, trimEnd: c.trimEnd, volume: vol }], [buf], [])
  }

  function toggleAll() {
    if (mode === 'all') return stopAll()
    stopAll()
    playRendered()
  }

  function openAudio() {
    if (mode === 'all') stopAll()
    audioOpen = true
  }

  /** Voiceover: Mikrofon starten, dann das ganze Video stumm von vorn abspielen. */
  async function startVoice() {
    if (voState !== 'idle') return
    stopAll()
    voState = 'starting'
    let session: VoiceoverSession
    try {
      session = await startVoiceover()
    } catch (err) {
      voState = 'idle'
      toasts.show(err instanceof Error ? err.message : 'Aufnahme nicht möglich', 'error')
      return
    }
    voSession = session
    voFirstFrame = null
    const ok = playRendered(undefined, {
      silent: true, // Projekt-Ton aus: kein Echo, iOS spielt währenddessen sonst über die Hörmuschel
      onReady: () => (voFirstFrame ??= performance.now()),
      onEnd: () => void finishVoice(),
    })
    if (!ok) {
      session.cancel()
      voSession = null
      voState = 'idle'
      return
    }
    voState = 'recording'
  }

  async function finishVoice() {
    const s = voSession
    if (!s || voState !== 'recording') return
    voSession = null
    voState = 'saving'
    const first = voFirstFrame
    stopAll()
    const blob = await s.stop()
    // iOS: Nach Mikrofon-Nutzung bleibt ein bestehender AudioContext oft auf der
    // Hörmuschel. Neu aufbauen lassen (nächster Tap).
    audio?.close()
    audio = null
    if (first === null || blob.size === 0) {
      voState = 'idle'
      toasts.show('Die Aufnahme war zu kurz.', 'warn')
      return
    }
    try {
      await store.setVoiceover(blob, {
        start: Math.max(0, (s.startedAt - first) / 1000),
        skip: Math.max(0, (first - s.startedAt) / 1000),
        mimeType: s.mimeType,
      })
    } catch (err) {
      toasts.show(err instanceof Error ? err.message : 'Aufnahme konnte nicht gespeichert werden', 'error')
    }
    voState = 'idle'
  }

  function openLook() {
    if (mode === 'all') stopAll()
    lookOpen = true
  }

  function openFaces() {
    if (mode === 'all') stopAll()
    facesOpen = true
  }

  function openTransition(index: number) {
    stopAll()
    sheetIndex = index
  }

  /** Spielt den Übergang mit je 1 s davor und danach. */
  function previewTransition() {
    if (previewingTransition) return stopAll()
    if (sheetIndex === null) return
    stopAll()
    const a = store.project.clips[sheetIndex]
    const k = a ? clips.indexOf(a) : -1
    if (k < 0 || k >= clips.length - 1) return
    const transitions = plainTransitions(store.playableTransitions)
    const starts = clipStartTimes(clips, transitions)
    const d = effectiveDurations(clips, transitions)[k] ?? 0
    const tStart = starts[k + 1]!
    if (playRendered({ from: Math.max(0, tStart - 1), to: tStart + d + 1 })) previewingTransition = true
  }

  /** „1,2 / 3,4 s“ – kompakt, damit die Werkzeugleiste auf schmale Displays passt. */
  const bare = (t: number) => formatPrecise(t).replace(/ s$/, '')
  const timeLabel = $derived(
    mode === 'all'
      ? `${bare(allTime)} / ${formatPrecise(store.totalDuration)}`
      : clip
        ? `${bare(Math.max(0, playhead - clip.trimStart))} / ${formatPrecise(clip.trimEnd - clip.trimStart)}`
        : '',
  )
</script>

<Screen title="Gesamt {formatPrecise(store.totalDuration)}" back={() => router.go('record')}>
  {#snippet actions()}
    <button class="primary" onclick={() => router.go('export')} disabled={!store.hasPlayableClips}>Export</button>
  {/snippet}

  <div class="cut">
    <AspectPicker value={store.project.outputAspect} onchange={(a) => store.setAspect(a)} disabled={mode === 'all'} />
    <div class="preview">
      <!-- svelte-ignore a11y_media_has_caption -->
      <video
        bind:this={single}
        src={clipUrl}
        playsinline
        preload="auto"
        class:hidden={(mode === 'all' && canvasReady) || (lookActive && lookDrawn)}
      ></video>
      <div class="stage" class:hidden={!lookActive || !lookDrawn || (mode === 'all' && canvasReady)} bind:this={lookStage}></div>
      <div class="stage" class:hidden={mode !== 'all' || !canvasReady} bind:this={stage}></div>
      {#if clip && mode !== 'all'}
        <CropFrame
          video={single}
          aspect={store.project.outputAspect}
          panX={clip.panX ?? 0.5}
          panY={clip.panY ?? 0.5}
          onchange={(x, y) => store.setPan(clip.id, x, y)}
        />
      {/if}
    </div>
    <SourceVideos bind:a={videoA} bind:b={videoB} />
    {#if debug && debugText}
      <div class="debug">{debugText}</div>
    {/if}

    <div class="controls">
      <button class="play" onclick={togglePlay} aria-label={mode === 'clip' ? 'Pause' : 'Clip abspielen'}>
        {mode === 'clip' ? '❚❚' : '▶'}
      </button>
      <span class="time">{timeLabel}</span>
      <button class="look" class:on={!!clip && !isNeutral(clip.look)} onclick={openLook} disabled={!clip}>Look</button>
      <button
        class="faces"
        class:on={facesOn(clip?.faces)}
        onclick={openFaces}
        disabled={!clip}
        aria-label="Gesichter">☺</button
      >
      <button
        class="sound"
        class:on={hasSoundEdits}
        onclick={openAudio}
        disabled={!clip}
        aria-label="Ton">{clip && (clip.volume ?? 1) === 0 ? '🔇' : '♪'}</button
      >
      <button class="all" class:on={mode === 'all'} onclick={toggleAll}>
        {mode === 'all' ? '■ Stopp' : '▶ Alles'}
      </button>
    </div>
    {#if mode === 'all'}
      <div class="progress"><div style:width="{(allTime / Math.max(0.01, store.totalDuration)) * 100}%"></div></div>
    {/if}

    {#if clip}
      {#key clip.id}
        <TrimEditor
          {clip}
          playhead={mode === 'all' ? null : playhead}
          disabled={mode === 'all'}
          ontrim={onTrim}
          onseek={onSeek}
          ondragstart={stopAll}
          ondragend={onDragEnd}
        />
      {/key}
    {/if}

    <ClipStrip
      selectedId={clip?.id ?? null}
      {playingId}
      onselect={select}
      ontransition={openTransition}
      reorderable={mode === 'idle'}
      activeTransition={sheetIndex}
    />
  </div>
</Screen>

{#if audioOpen && clip}
  <AudioSheet
    clipId={clip.id}
    recording={voState}
    recTime={allTime}
    playing={mode === 'all' && voState === 'idle'}
    onrecord={() => void startVoice()}
    onstoprecord={() => void finishVoice()}
    onpreview={toggleAll}
    onclose={() => {
      if (voState === 'recording') void finishVoice()
      audioOpen = false
    }}
  />
{/if}

{#if facesOpen && clip}
  <FaceSheet clipId={clip.id} video={single} time={playhead} onclose={() => (facesOpen = false)} />
{/if}

{#if lookOpen && clip}
  <LookSheet clipId={clip.id} onclose={() => (lookOpen = false)} />
{/if}

{#if sheetIndex !== null}
  <TransitionSheet
    index={sheetIndex}
    previewing={previewingTransition}
    onpreview={previewTransition}
    onclose={() => {
      stopAll()
      sheetIndex = null
    }}
  />
{/if}

<style>
  .cut {
    display: flex;
    flex-direction: column;
    height: 100%;
    gap: 6px;
  }
  .preview {
    position: relative;
    flex: 1;
    min-height: 160px;
    border-radius: var(--radius);
    overflow: hidden;
    background: #000;
  }
  video {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
  /* opacity statt display:none: iOS dekodiert versteckte Videos sonst nicht vor */
  .hidden {
    opacity: 0;
    pointer-events: none;
  }
  .stage {
    position: absolute;
    inset: 0;
  }
  .stage :global(.stage-canvas) {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
  .debug {
    font: 11px/1.3 ui-monospace, monospace;
    color: #0f0;
    background: rgba(0, 0, 0, 0.7);
    padding: 2px 6px;
    border-radius: 4px;
    white-space: pre-wrap;
  }
  .controls {
    display: grid;
    grid-template-columns: auto 1fr auto auto auto auto;
    align-items: center;
    gap: 8px;
  }
  .play {
    width: 48px;
    padding: 0;
    font-size: 1rem;
  }
  .time {
    text-align: center;
    font-variant-numeric: tabular-nums;
    color: var(--muted);
    font-size: 0.85rem;
    white-space: nowrap;
    min-width: 0;
    overflow: hidden;
  }
  .faces,
  .sound {
    font-size: 1.15rem;
    padding-left: 0.6rem;
    padding-right: 0.6rem;
  }
  .look,
  .sound {
    padding-left: 0.7rem;
    padding-right: 0.7rem;
  }
  .look.on,
  .faces.on,
  .sound.on,
  .all.on {
    background: var(--accent);
    color: #000;
  }
  .progress {
    height: 3px;
    background: var(--surface-2);
    border-radius: 2px;
    overflow: hidden;
  }
  .progress div {
    height: 100%;
    background: var(--accent);
  }
</style>
