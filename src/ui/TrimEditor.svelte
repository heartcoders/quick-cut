<script lang="ts">
  import type { Clip } from '../lib/project/types'
  import { clamp, moveHandle, pxToTime, round2, timeToPx, type Handle } from '../lib/timeline/timeline'
  import { formatPrecise } from './format'

  let {
    clip,
    playhead,
    disabled = false,
    ontrim,
    onseek,
    ondragstart,
    ondragend,
  }: {
    clip: Clip
    playhead: number | null
    disabled?: boolean
    ontrim: (trimStart: number, trimEnd: number, handle: Handle) => void
    onseek: (t: number) => void
    ondragstart?: () => void
    ondragend?: () => void
  } = $props()

  const NUDGE = 0.1

  let width = $state(0)
  let track: HTMLDivElement | undefined = $state()
  let dragging = $state<Handle | 'scrub' | null>(null)
  let grabOffset = 0
  let wasAtLimit = false

  const startPx = $derived(timeToPx(clip.trimStart, width, clip.duration))
  const endPx = $derived(timeToPx(clip.trimEnd, width, clip.duration))
  const playheadPx = $derived(playhead === null ? null : timeToPx(playhead, width, clip.duration))

  function localX(e: PointerEvent): number {
    return e.clientX - (track?.getBoundingClientRect().left ?? 0)
  }

  function applyHandle(handle: Handle, t: number) {
    const r = moveHandle(clip, handle, t)
    if (r.hitLimit && !wasAtLimit) navigator.vibrate?.(10)
    wasAtLimit = r.hitLimit
    if (r.trimStart !== clip.trimStart || r.trimEnd !== clip.trimEnd) ontrim(r.trimStart, r.trimEnd, handle)
  }

  function onHandleDown(handle: Handle, e: PointerEvent) {
    if (disabled || !e.isPrimary) return
    e.preventDefault()
    e.stopPropagation()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    dragging = handle
    wasAtLimit = false
    grabOffset = localX(e) - (handle === 'start' ? startPx : endPx)
    ondragstart?.()
  }

  function onTrackDown(e: PointerEvent) {
    if (disabled || !e.isPrimary) return
    e.preventDefault()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    dragging = 'scrub'
    scrub(e)
  }

  function scrub(e: PointerEvent) {
    const t = pxToTime(localX(e), width, clip.duration)
    onseek(round2(clamp(t, clip.trimStart, clip.trimEnd)))
  }

  function onMove(e: PointerEvent) {
    if (!dragging || !e.isPrimary) return
    if (dragging === 'scrub') return scrub(e)
    applyHandle(dragging, pxToTime(localX(e) - grabOffset, width, clip.duration))
  }

  function onUp(e: PointerEvent) {
    if (!dragging || !e.isPrimary) return
    const wasHandle = dragging !== 'scrub'
    dragging = null
    if (wasHandle) ondragend?.()
  }

  function nudge(handle: Handle, delta: number) {
    wasAtLimit = false
    applyHandle(handle, round2((handle === 'start' ? clip.trimStart : clip.trimEnd) + delta))
  }
</script>

<div class="editor" class:disabled>
  <div
    class="track"
    bind:this={track}
    bind:clientWidth={width}
    onpointerdown={onTrackDown}
    onpointermove={onMove}
    onpointerup={onUp}
    onpointercancel={onUp}
    role="slider"
    tabindex="-1"
    aria-label="Position im Clip"
    aria-valuemin={clip.trimStart}
    aria-valuemax={clip.trimEnd}
    aria-valuenow={playhead ?? clip.trimStart}
  >
    <div class="film">
      {#each clip.thumbnails as src, i (i)}
        <img {src} alt="" draggable="false" />
      {/each}
    </div>

    <div class="dim" style:left="0" style:width="{startPx}px"></div>
    <div class="dim" style:left="{endPx}px" style:right="0"></div>
    <div class="frame" style:left="{startPx}px" style:width="{endPx - startPx}px"></div>

    {#if playheadPx !== null && !dragging}
      <div class="playhead" style:left="{playheadPx}px"></div>
    {/if}

    {#each ['start', 'end'] as const as handle (handle)}
      {@const px = handle === 'start' ? startPx : endPx}
      <div
        class="handle {handle}"
        class:active={dragging === handle}
        style:left="{px}px"
        onpointerdown={(e) => onHandleDown(handle, e)}
        onpointermove={onMove}
        onpointerup={onUp}
        onpointercancel={onUp}
        role="slider"
        tabindex="0"
        aria-label={handle === 'start' ? 'Startpunkt' : 'Endpunkt'}
        aria-valuemin={0}
        aria-valuemax={clip.duration}
        aria-valuenow={handle === 'start' ? clip.trimStart : clip.trimEnd}
      >
        <span class="bar"><span class="chev">{handle === 'start' ? '‹' : '›'}</span></span>
        {#if dragging === handle}
          <span class="label">{formatPrecise(handle === 'start' ? clip.trimStart : clip.trimEnd)}</span>
        {/if}
      </div>
    {/each}
  </div>

  <div class="fine">
    <div class="group">
      <button onclick={() => nudge('start', -NUDGE)} aria-label="Start 0,1 s früher" {disabled}>−</button>
      <span><small>Start</small>{formatPrecise(clip.trimStart)}</span>
      <button onclick={() => nudge('start', NUDGE)} aria-label="Start 0,1 s später" {disabled}>+</button>
    </div>
    <div class="len">{formatPrecise(clip.trimEnd - clip.trimStart)}</div>
    <div class="group">
      <button onclick={() => nudge('end', -NUDGE)} aria-label="Ende 0,1 s früher" {disabled}>−</button>
      <span><small>Ende</small>{formatPrecise(clip.trimEnd)}</span>
      <button onclick={() => nudge('end', NUDGE)} aria-label="Ende 0,1 s später" {disabled}>+</button>
    </div>
  </div>
</div>

<style>
  .editor {
    padding: 28px 22px 0; /* Platz für Griffe und Zeit-Label */
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
  }
  .disabled {
    opacity: 0.5;
    pointer-events: none;
  }
  .track {
    position: relative;
    height: 56px;
    touch-action: none;
  }
  .film {
    position: absolute;
    inset: 0;
    display: flex;
    overflow: hidden;
    border-radius: 4px;
    background: var(--surface-2);
  }
  .film img {
    flex: 1 1 0;
    min-width: 0;
    height: 100%;
    object-fit: cover;
    pointer-events: none;
  }
  .dim {
    position: absolute;
    top: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.6);
    pointer-events: none;
  }
  .frame {
    position: absolute;
    top: -3px;
    bottom: -3px;
    border-top: 3px solid var(--accent);
    border-bottom: 3px solid var(--accent);
    pointer-events: none;
  }
  .playhead {
    position: absolute;
    top: -6px;
    bottom: -6px;
    width: 3px;
    margin-left: -1.5px;
    border-radius: 2px;
    background: #fff;
    box-shadow: 0 0 4px rgba(0, 0, 0, 0.6);
    pointer-events: none;
  }
  /* 44 px Trefferfläche, sichtbarer Balken 14 px außerhalb des Rahmens */
  .handle {
    position: absolute;
    top: -3px;
    bottom: -3px;
    width: 44px;
    touch-action: none;
    z-index: 2;
  }
  .handle.start {
    margin-left: -36px;
  }
  .handle.end {
    margin-left: -8px;
  }
  .bar {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 14px;
    background: var(--accent);
    display: grid;
    place-items: center;
    color: #000;
    font-weight: 800;
  }
  .start .bar {
    right: 8px;
    border-radius: 6px 0 0 6px;
  }
  .end .bar {
    left: 8px;
    border-radius: 0 6px 6px 0;
  }
  .active .bar {
    filter: brightness(1.15);
  }
  .label {
    position: absolute;
    bottom: calc(100% + 6px);
    left: 50%;
    transform: translateX(-50%);
    padding: 1px 8px;
    border-radius: 6px;
    background: var(--accent);
    color: #000;
    font-size: 0.8rem;
    font-weight: 600;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  .fine {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: 12px;
    font-variant-numeric: tabular-nums;
  }
  .group {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .group span {
    display: flex;
    flex-direction: column;
    align-items: center;
    min-width: 52px;
    font-size: 0.85rem;
    white-space: nowrap;
  }
  .group small {
    color: var(--muted);
    font-size: 0.7rem;
  }
  .group button {
    width: 36px;
    min-height: 40px;
    padding: 0;
  }
  .len {
    white-space: nowrap;
    color: var(--accent);
    font-weight: 600;
    font-size: 0.9rem;
  }
</style>
