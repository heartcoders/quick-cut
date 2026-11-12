<script lang="ts">
  import type { AspectRatio } from '../lib/project/types'
  import { coverCrop, outputSize } from '../lib/renderer/geometry'

  /**
   * Rahmen über der Einzelvorschau (Video mit object-fit: contain): zeigt den
   * Ausschnitt im Zielformat und lässt ihn per Ziehen verschieben.
   * Dieselbe Rechnung wie der Renderer (coverCrop), damit Vorschau = Export.
   */
  let {
    video,
    aspect,
    panX,
    panY,
    onchange,
  }: {
    video: HTMLVideoElement | undefined
    aspect: AspectRatio
    panX: number
    panY: number
    onchange: (panX: number, panY: number) => void
  } = $props()

  let boxW = $state(0)
  let boxH = $state(0)
  let vw = $state(0)
  let vh = $state(0)

  // Videogröße nachführen (neue Quelle, iOS meldet sie manchmal erst später).
  $effect(() => {
    const el = video
    if (!el) return
    const update = () => {
      vw = el.videoWidth
      vh = el.videoHeight
    }
    update()
    el.addEventListener('loadedmetadata', update)
    el.addEventListener('resize', update)
    return () => {
      el.removeEventListener('loadedmetadata', update)
      el.removeEventListener('resize', update)
    }
  })

  const geo = $derived.by(() => {
    if (!vw || !vh || !boxW || !boxH) return null
    const out = outputSize(aspect)
    const fit = Math.min(boxW / vw, boxH / vh)
    const dispW = vw * fit
    const dispH = vh * fit
    const c = coverCrop(vw, vh, out.width, out.height, 0, panX, panY)
    const [sx, sy] = c.uvScale
    return {
      sx,
      sy,
      dispW,
      dispH,
      x: (boxW - dispW) / 2 + c.uvOffset[0] * dispW,
      y: (boxH - dispH) / 2 + c.uvOffset[1] * dispH,
      w: sx * dispW,
      h: sy * dispH,
    }
  })

  /** Nur zeigen, wenn wirklich etwas abgeschnitten wird. */
  const movable = $derived(!!geo && (geo.sx < 0.995 || geo.sy < 0.995))

  let drag: { id: number; x: number; y: number; panX: number; panY: number } | null = null

  function down(e: PointerEvent) {
    if (!movable) return
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, panX, panY }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    e.preventDefault()
  }

  function move(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.id || !geo) return
    const rangeX = (1 - geo.sx) * geo.dispW
    const rangeY = (1 - geo.sy) * geo.dispH
    const nx = rangeX > 0.5 ? drag.panX + (e.clientX - drag.x) / rangeX : 0.5
    const ny = rangeY > 0.5 ? drag.panY + (e.clientY - drag.y) / rangeY : 0.5
    onchange(Math.min(1, Math.max(0, nx)), Math.min(1, Math.max(0, ny)))
  }

  function up(e: PointerEvent) {
    if (drag?.id === e.pointerId) drag = null
  }
</script>

<div
  class="crop"
  bind:clientWidth={boxW}
  bind:clientHeight={boxH}
  class:active={movable}
  role="application"
  aria-label="Ausschnitt verschieben"
  onpointerdown={down}
  onpointermove={move}
  onpointerup={up}
  onpointercancel={up}
  ondblclick={() => onchange(0.5, 0.5)}
>
  {#if movable && geo}
    <div class="frame" style:left="{geo.x}px" style:top="{geo.y}px" style:width="{geo.w}px" style:height="{geo.h}px">
      <span class="hint">Ziehen zum Verschieben</span>
    </div>
  {/if}
</div>

<style>
  .crop {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
  }
  .crop.active {
    pointer-events: auto;
    touch-action: none;
    cursor: grab;
  }
  .frame {
    position: absolute;
    border: 2px solid #fff;
    border-radius: 2px;
    /* alles außerhalb des Ausschnitts abdunkeln */
    box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.6);
    box-sizing: border-box;
    display: flex;
    align-items: flex-end;
    justify-content: center;
  }
  .hint {
    margin-bottom: 6px;
    font-size: 0.75rem;
    padding: 2px 8px;
    border-radius: 10px;
    background: rgba(0, 0, 0, 0.5);
    color: #fff;
    white-space: nowrap;
  }
</style>
