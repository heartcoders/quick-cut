<script lang="ts">
  import { fly } from 'svelte/transition'
  import { toasts } from './toast.svelte'
</script>

<div class="toasts" aria-live="polite">
  {#each toasts.items as t (t.id)}
    <button class="toast {t.kind}" transition:fly={{ y: -16, duration: 180 }} onclick={() => toasts.dismiss(t.id)}>
      {t.text}
    </button>
  {/each}
</div>

<style>
  .toasts {
    position: fixed;
    top: calc(var(--safe-top) + 64px);
    left: 12px;
    right: 12px;
    z-index: 100;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    pointer-events: none;
  }
  .toast {
    pointer-events: auto;
    max-width: 480px;
    width: 100%;
    text-align: left;
    font-size: 0.9rem;
    background: rgba(30, 30, 30, 0.95);
    border-left: 4px solid var(--muted);
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.4);
  }
  .warn {
    border-left-color: var(--accent);
  }
  .error {
    border-left-color: var(--danger);
  }
</style>
