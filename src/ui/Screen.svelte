<script lang="ts">
  import type { Snippet } from 'svelte'

  let {
    title,
    back,
    actions,
    children,
  }: { title: string; back?: () => void; actions?: Snippet; children: Snippet } = $props()
</script>

<section class="screen">
  <header>
    {#if back}
      <button class="back" onclick={back} aria-label="Zurück">‹</button>
    {:else}
      <span class="spacer"></span>
    {/if}
    <h1>{title}</h1>
    <div class="actions">{@render actions?.()}</div>
  </header>
  <main>{@render children()}</main>
</section>

<style>
  .screen {
    display: flex;
    flex-direction: column;
    height: 100%;
  }
  header {
    display: grid;
    grid-template-columns: 56px 1fr auto;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
  }
  h1 {
    margin: 0;
    font-size: 1.05rem;
    text-align: center;
  }
  .back {
    font-size: 1.6rem;
    line-height: 1;
    padding: 0.3rem 0.8rem;
  }
  .actions {
    min-width: 56px;
    display: flex;
    justify-content: flex-end;
  }
  main {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 0.75rem;
  }
</style>
