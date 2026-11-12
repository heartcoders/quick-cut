<script lang="ts">
  import { onMount } from 'svelte'
  import { startRender, type RenderJob } from '../lib/export/exportV1'
  import { buildRenderClips, plainTransitions } from '../lib/export/renderInput'
  import { getClipUrl } from '../lib/media/clipUrls'
  import { playRange } from '../lib/media/rangePlayer'
  import { createSeeker, type Seeker } from '../lib/media/seeker'
  import { store } from '../lib/project/store.svelte'
  import { AudioGraph } from '../lib/renderer/audioGraph'
  import { createRenderer } from '../lib/renderer/createRenderer'
  import type { RenderClip, Renderer } from '../lib/renderer/types'
  import { router } from '../lib/router.svelte'
  import { clipStartTimes, effectiveDurations, type Handle } from '../lib/timeline/timeline'
  import { SequencePlayer } from '../lib/media/sequencePlayer'
  import ClipStrip from '../ui/ClipStrip.svelte'
  import SourceVideos from '../ui/SourceVideos.svelte'
  import { formatPrecise } from '../ui/format'
  import Screen from '../ui/Screen.svelte'
  import TransitionSheet from '../ui/TransitionSheet.svelte'
  import TrimEditor from '../ui/TrimEditor.svelte'

  type Mode = 'idle' | 'clip' | 'all'

  let selectedId = $state<string | null>(null)
  let mode = $state<Mode>('idle')
  let playhead = $state(0) // lokale Zeit im gewählten Clip
  let allTime = $state(0) // Gesamtzeit bei „Alles abspielen“
  let canvasReady = $state(false) // erster Frame im Canvas → Einzelvorschau ausblenden
  let urls = $state<Record<string, string>>({})
  let renderClips = $state<RenderClip[]>([])
  let sheetIndex = $state<number | null>(null)
  let previewingTransition = $state(false)
  let playingId = $state<string | null>(null) // Clip, der bei „Alles“ gerade läuft
  const debug = new URLSearchParams(location.search).has('debug')
  let debugText = $state('')

  let single: HTMLVideoElement | undefined = $state()
  let videoA: HTMLVideoElement | undefined = $state()
  let videoB: HTMLVideoElement | undefined = $state()
  let stage: HTMLDivElement | undefined = $state()
  let seeker: Seeker | null = null
  let renderer = $state.raw<Renderer | null>(null)
  let audio: AudioGraph | null = null
  let job: RenderJob | null = null
  let stopRange: (() => void) | null = null

  const clips = $derived(store.playableClips)
  const clip = $derived(clips.find((c) => c.id === selectedId) ?? clips[0])
  const clipUrl = $derived(clip ? urls[clip.blobKey] : undefined)

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
    })
    return () => (cancelled = true)
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

  onMount(() => {
    if (single) seeker = createSeeker(single)
    try {
      renderer = createRenderer()
      renderer.canvas.classList.add('stage-canvas')
      stage?.append(renderer.canvas)
    } catch (err) {
      console.error('Renderer nicht verfügbar', err)
    }
    return () => {
      stopAll()
      seeker?.dispose()
      renderer?.dispose()
      audio?.close()
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
  function playRendered(range?: { from: number; to: number }) {
    if (!renderer || !videoA || !videoB || renderClips.length === 0) return false
    audio ??= AudioGraph.tryCreate()
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
      audio,
      record: false,
      fromTime: range?.from,
      toTime: range?.to,
      onProgress: (t) => (allTime = t),
      // Canvas erst zeigen, wenn Clip 1 wirklich gezeichnet ist – vorher bleibt
      // die Einzelvorschau stehen (kein Schwarzbild).
      onReady: () => (canvasReady = true),
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
    stopRange = playRange(single, from, clip.trimEnd, {
      onTime: (t) => (playhead = t),
      onEnd: () => {
        stopRange = null
        mode = 'idle'
      },
    })
  }

  function toggleAll() {
    if (mode === 'all') return stopAll()
    stopAll()
    playRendered()
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

  const timeLabel = $derived(
    mode === 'all'
      ? `${formatPrecise(allTime)} / ${formatPrecise(store.totalDuration)}`
      : clip
        ? `${formatPrecise(Math.max(0, playhead - clip.trimStart))} / ${formatPrecise(clip.trimEnd - clip.trimStart)}`
        : '',
  )
</script>

<Screen title="Gesamt {formatPrecise(store.totalDuration)}" back={() => router.go('record')}>
  {#snippet actions()}
    <button class="primary" onclick={() => router.go('export')} disabled={!store.hasPlayableClips}>Export</button>
  {/snippet}

  <div class="cut">
    <div class="preview">
      <!-- svelte-ignore a11y_media_has_caption -->
      <video bind:this={single} src={clipUrl} playsinline preload="auto" class:hidden={mode === 'all' && canvasReady}
      ></video>
      <div class="stage" class:hidden={mode !== 'all' || !canvasReady} bind:this={stage}></div>
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
    grid-template-columns: auto 1fr auto;
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
    font-size: 0.9rem;
  }
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
