<script lang="ts">
  import { tick } from 'svelte'
  import { UNPLAYABLE_HINT } from '../lib/import/importFiles'
  import { store } from '../lib/project/store.svelte'
  import type { Clip } from '../lib/project/types'
  import { targetIndex } from '../lib/timeline/reorder'
  import { formatShort } from './format'
  import { toasts } from './toast.svelte'

  let {
    selectedId = null,
    onselect,
    removable = true,
    ontransition,
    activeTransition = null,
    reorderable = false,
  }: {
    selectedId?: string | null
    onselect?: (id: string) => void
    removable?: boolean
    /** Gesetzt → zwischen den Clips erscheinen Übergangs-Knöpfe. */
    ontransition?: (index: number) => void
    activeTransition?: number | null
    /** Halten (350 ms) und Ziehen ändert die Reihenfolge. */
    reorderable?: boolean
  } = $props()

  const HOLD_MS = 350
  const MOVE_TOLERANCE = 8
  const EDGE = 40

  interface Drag {
    from: number
    to: number
    dx: number
    pitch: number
    centers: number[]
    startX: number
  }
  let drag = $state<Drag | null>(null)
  let pending: { i: number; x: number; y: number; id: number; el: HTMLElement; timer: ReturnType<typeof setTimeout> } | null =
    null
  let suppressClick = false

  /** x in Inhaltskoordinaten der Leiste (berücksichtigt Scrollposition). */
  function contentX(clientX: number): number {
    if (!scroller) return clientX
    return clientX - scroller.getBoundingClientRect().left + scroller.scrollLeft
  }

  function onTileDown(i: number, e: PointerEvent) {
    if (!reorderable || !e.isPrimary || drag) return
    const el = e.currentTarget as HTMLElement
    pending = { i, x: e.clientX, y: e.clientY, id: e.pointerId, el, timer: setTimeout(() => startDrag(), HOLD_MS) }
  }

  function startDrag() {
    if (!pending || !scroller) return
    const tiles = [...scroller.querySelectorAll<HTMLElement>('.tile')]
    const rects = tiles.map((t) => t.getBoundingClientRect())
    const base = scroller.getBoundingClientRect().left - scroller.scrollLeft
    const centers = rects.map((r) => r.left - base + r.width / 2)
    const pitch = centers.length > 1 ? centers[1]! - centers[0]! : (rects[0]?.width ?? 48)
    try {
      pending.el.setPointerCapture(pending.id)
    } catch {
      /* Pointer schon weg */
    }
    navigator.vibrate?.(15)
    drag = { from: pending.i, to: pending.i, dx: 0, pitch, centers, startX: contentX(pending.x) }
    pending = null
  }

  function cancelPending() {
    if (pending) clearTimeout(pending.timer)
    pending = null
  }

  function onTileMove(e: PointerEvent) {
    if (pending && Math.hypot(e.clientX - pending.x, e.clientY - pending.y) > MOVE_TOLERANCE) cancelPending()
    if (!drag || !scroller) return
    // Am Rand automatisch scrollen.
    const r = scroller.getBoundingClientRect()
    if (e.clientX < r.left + EDGE) scroller.scrollLeft -= 8
    else if (e.clientX > r.right - EDGE) scroller.scrollLeft += 8
    const x = contentX(e.clientX)
    drag.dx = x - drag.startX
    drag.to = targetIndex(drag.centers[drag.from]! + drag.dx, drag.centers, drag.from)
  }

  function onTileUp() {
    cancelPending()
    if (!drag) return
    const { from, to } = drag
    drag = null
    suppressClick = true
    setTimeout(() => (suppressClick = false), 0)
    store.moveClip(from, to)
  }

  function onTileCancel() {
    cancelPending()
    drag = null
  }

  /** Verschiebung der übrigen Kacheln, damit die Lücke an der Zielposition entsteht. */
  function shiftFor(i: number, d: Drag): number {
    if (i === d.from) return d.dx
    if (d.from < d.to && i > d.from && i <= d.to) return -d.pitch
    if (d.to < d.from && i >= d.to && i < d.from) return d.pitch
    return 0
  }

  // Während des Ziehens darf die Leiste nicht scrollen (iOS/Android): nicht-passiver touchmove.
  $effect(() => {
    const el = scroller
    if (!el || !reorderable) return
    const block = (e: TouchEvent) => {
      if (drag) e.preventDefault()
    }
    el.addEventListener('touchmove', block, { passive: false })
    return () => el.removeEventListener('touchmove', block)
  })

  const ICONS: Record<string, string> = { none: '│', crossfade: '◐', slide: '⇤', wipe: '▧' }
  const LABELS: Record<string, string> = { none: 'kein Übergang', crossfade: 'Überblenden', slide: 'Schieben', wipe: 'Wischen' }

  let scroller: HTMLDivElement | undefined = $state()
  let lastCount = 0

  function select(clip: Clip) {
    if (suppressClick) return
    if (clip.status === 'error') toasts.show(UNPLAYABLE_HINT, 'error', 7000)
    else if (clip.status === 'ready') onselect?.(clip.id)
  }

  // Bei neuem Clip ans Ende scrollen.
  $effect(() => {
    const count = store.project.clips.length
    if (count > lastCount && scroller) {
      void tick().then(() => scroller?.scrollTo({ left: scroller.scrollWidth, behavior: 'smooth' }))
    }
    lastCount = count
  })
</script>

<div class="strip" class:dragging={drag !== null} bind:this={scroller}>
  {#each store.project.clips as clip, i (clip.id)}
    <div
      class="tile"
      class:selected={clip.id === selectedId}
      class:error={clip.status === 'error'}
      class:lifted={drag?.from === i}
      style:transform={drag ? `translateX(${shiftFor(i, drag)}px)${drag.from === i ? ' scale(1.08)' : ''}` : undefined}
      onpointerdown={(e) => onTileDown(i, e)}
      onpointermove={onTileMove}
      onpointerup={onTileUp}
      onpointercancel={onTileCancel}
      role="listitem"
    >
      <button
        class="thumb"
        onclick={() => select(clip)}
        aria-label="Clip {formatShort(clip.trimEnd - clip.trimStart)}"
      >
        {#if clip.thumbnails[0]}
          <img src={clip.thumbnails[0]} alt="" draggable="false" />
        {/if}
        {#if clip.status === 'processing'}
          <span class="spinner" aria-label="Wird verarbeitet"></span>
        {:else if clip.status === 'error'}
          <span class="badge" title="Format nicht unterstützt">!</span>
        {:else}
          <span class="dur">{formatShort(clip.trimEnd - clip.trimStart)}</span>
        {/if}
      </button>
      {#if removable}
        <button class="remove" onclick={() => store.removeClip(clip.id)} aria-label="Clip löschen">✕</button>
      {/if}
    </div>
    {#if ontransition && i < store.project.clips.length - 1}
      {@const tr = store.project.transitions[i]}
      <button
        class="transition"
        class:set={tr && tr.type !== 'none'}
        class:active={activeTransition === i}
        disabled={store.maxTransitionAt(i) <= 0}
        onclick={() => ontransition(i)}
        aria-label="Übergang {i + 1}: {LABELS[tr?.type ?? 'none']}"
      >
        {ICONS[tr?.type ?? 'none']}
      </button>
    {/if}
  {/each}
</div>

<style>
  .strip {
    display: flex;
    gap: 6px;
    overflow-x: auto;
    padding: 10px 2px 2px;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
  }
  .strip::-webkit-scrollbar {
    display: none;
  }
  .tile {
    position: relative;
    flex: 0 0 auto;
    -webkit-touch-callout: none;
    user-select: none;
    -webkit-user-select: none;
  }
  .dragging .tile {
    transition: transform 150ms ease;
  }
  .dragging .tile.lifted {
    transition: none;
    z-index: 5;
    filter: drop-shadow(0 6px 10px rgba(0, 0, 0, 0.6));
  }
  .dragging .transition,
  .dragging .remove {
    opacity: 0;
    pointer-events: none;
  }
  .thumb {
    position: relative;
    width: 48px;
    height: 72px;
    min-height: 0;
    padding: 0;
    overflow: hidden;
    border-radius: 8px;
    background: var(--surface-2);
    outline: 2px solid transparent;
    outline-offset: 1px;
  }
  .selected .thumb {
    outline-color: var(--accent);
  }
  .error .thumb {
    outline-color: var(--danger);
  }
  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    -webkit-user-drag: none;
  }
  .dur {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    font-size: 0.65rem;
    text-align: center;
    background: linear-gradient(transparent, rgba(0, 0, 0, 0.75));
    padding: 6px 0 2px;
  }
  .badge {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    font-weight: 700;
    color: var(--danger);
    background: rgba(0, 0, 0, 0.5);
  }
  .spinner {
    position: absolute;
    inset: 0;
    margin: auto;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-top-color: #fff;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .transition {
    flex: 0 0 auto;
    align-self: center;
    width: 26px;
    height: 44px;
    min-height: 0;
    padding: 0;
    margin: 0 -2px;
    border-radius: 8px;
    font-size: 0.85rem;
    background: rgba(40, 40, 40, 0.9);
    color: var(--muted);
  }
  .transition.set {
    color: var(--accent);
  }
  .transition.active {
    outline: 2px solid var(--accent);
  }
  .transition:disabled {
    opacity: 0.25;
  }
  .remove {
    position: absolute;
    top: -8px;
    right: -8px;
    width: 22px;
    height: 22px;
    min-height: 0;
    padding: 0;
    border-radius: 50%;
    font-size: 0.65rem;
    background: rgba(40, 40, 40, 0.95);
    border: 1px solid rgba(255, 255, 255, 0.25);
  }
  /* größere Trefferfläche für den kleinen Löschen-Knopf */
  .remove::after {
    content: '';
    position: absolute;
    inset: -10px;
  }
</style>
