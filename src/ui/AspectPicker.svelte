<script lang="ts">
  import type { AspectRatio } from '../lib/project/types'

  let { value, onchange, disabled = false }: { value: AspectRatio; onchange: (a: AspectRatio) => void; disabled?: boolean } =
    $props()

  const options: { value: AspectRatio; label: string; w: number; h: number }[] = [
    { value: '9:16', label: 'Hoch', w: 9, h: 16 },
    { value: '1:1', label: 'Quadrat', w: 12, h: 12 },
    { value: '16:9', label: 'Quer', w: 16, h: 9 },
  ]
</script>

<div class="picker" role="radiogroup" aria-label="Ausgabeformat">
  {#each options as o (o.value)}
    <button
      role="radio"
      aria-checked={value === o.value}
      class:on={value === o.value}
      {disabled}
      onclick={() => onchange(o.value)}
    >
      <span class="shape" style:width="{o.w * 1.3}px" style:height="{o.h * 1.3}px"></span>
      <span class="text">{o.value}</span>
    </button>
  {/each}
</div>

<style>
  .picker {
    display: flex;
    gap: 8px;
    justify-content: center;
  }
  button {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0.5rem 0.9rem;
  }
  .shape {
    border: 2px solid currentColor;
    border-radius: 3px;
  }
  .on {
    background: var(--accent);
    color: #000;
    font-weight: 600;
  }
  .text {
    font-variant-numeric: tabular-nums;
  }
</style>
