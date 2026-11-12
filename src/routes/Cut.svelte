<script lang="ts">
  import { onMount } from 'svelte'
  import { getClipUrl } from '../lib/media/clipUrls'
  import { playRange } from '../lib/media/rangePlayer'
  import { createSeeker, type Seeker } from '../lib/media/seeker'
  import { SequencePlayer } from '../lib/media/sequencePlayer'
  import { store } from '../lib/project/store.svelte'
  import { router } from '../lib/router.svelte'
  import type { Handle } from '../lib/timeline/timeline'
  import ClipStrip from '../ui/ClipStrip.svelte'
  import { formatPrecise } from '../ui/format'
  import Screen from '../ui/Screen.svelte'
  import TrimEditor from '../ui/TrimEditor.svelte'

  type Mode = 'idle' | 'clip' | 'all'

  let selectedId = $state<string | null>(null)
  let mode = $state<Mode>('idle')
  let playhead = $state(0) // lokale Zeit im gewählten Clip
  let allTime = $state(0) // Gesamtzeit bei „Alles abspielen“
  let activeAB = $state<0 | 1 | null>(null) // null: A/B noch nicht bereit
  let urls = $state<Record<string, string>>({})

  let single: HTMLVideoElement | undefined = $state()
  let videoA: HTMLVideoElement | undefined = $state()
  let videoB: HTMLVideoElement | undefined = $state()
  let seeker: Seeker | null = null
  let sequence: SequencePlayer | null = null
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
    if (videoA && videoB) {
      sequence = new SequencePlayer(videoA, videoB, {
        onTime: (t) => (allTime = t),
        onSwitch: (a) => (activeAB = a),
        onEnd: () => {
          mode = 'idle'
          activeAB = null
        },
      })
    }
    return () => {
      stopAll()
      seeker?.dispose()
    }
  })

  function stopAll() {
    stopRange?.()
    stopRange = null
    sequence?.stop()
    activeAB = null
    mode = 'idle'
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
    const seq = clips.map((c) => ({ ...c, url: urls[c.blobKey] ?? '' })).filter((c) => c.url)
    if (!sequence || seq.length === 0) return
    allTime = 0
    mode = 'all'
    sequence.start(seq)
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
      <video bind:this={single} src={clipUrl} playsinline preload="auto" class:hidden={mode === 'all' && activeAB !== null}></video>
      <!-- svelte-ignore a11y_media_has_caption -->
      <video bind:this={videoA} playsinline preload="auto" class="ab" class:hidden={mode !== 'all' || activeAB !== 0}
      ></video>
      <!-- svelte-ignore a11y_media_has_caption -->
      <video bind:this={videoB} playsinline preload="auto" class="ab" class:hidden={mode !== 'all' || activeAB !== 1}
      ></video>
    </div>

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

    <ClipStrip selectedId={clip?.id ?? null} onselect={select} />
  </div>
</Screen>

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
