<script lang="ts">
  let {
    progress,
    size = 88,
    stroke = 5,
    color = 'var(--danger)',
  }: { progress: number; size?: number; stroke?: number; color?: string } = $props()

  const r = $derived((size - stroke) / 2)
  const c = $derived(2 * Math.PI * r)
  const offset = $derived(c * (1 - Math.min(1, Math.max(0, progress))))
</script>

<svg width={size} height={size} viewBox="0 0 {size} {size}" aria-hidden="true">
  <circle cx={size / 2} cy={size / 2} {r} fill="none" stroke="rgba(255,255,255,.85)" stroke-width={stroke} />
  <circle
    cx={size / 2}
    cy={size / 2}
    {r}
    fill="none"
    stroke={color}
    stroke-width={stroke}
    stroke-dasharray={c}
    stroke-dashoffset={offset}
    stroke-linecap="round"
    transform="rotate(-90 {size / 2} {size / 2})"
  />
</svg>

<style>
  svg {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
</style>
