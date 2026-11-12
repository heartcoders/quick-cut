<script lang="ts">
  import { router } from '../lib/router.svelte'
  import { settings, type DefaultFacing } from '../lib/settings.svelte'
  import Screen from '../ui/Screen.svelte'

  const FACINGS: { value: DefaultFacing; label: string }[] = [
    { value: 'user', label: 'Vorne' },
    { value: 'environment', label: 'Hinten' },
    { value: 'last', label: 'Zuletzt benutzt' },
  ]
</script>

<Screen title="Einstellungen" back={() => router.go('home')}>
  <section>
    <h2 id="facing">Kamera beim Öffnen</h2>
    <div class="options" role="radiogroup" aria-labelledby="facing">
      {#each FACINGS as f (f.value)}
        <button
          role="radio"
          aria-checked={settings.value.defaultFacing === f.value}
          class:on={settings.value.defaultFacing === f.value}
          onclick={() => settings.set('defaultFacing', f.value)}>{f.label}</button
        >
      {/each}
    </div>
  </section>
</Screen>

<style>
  section {
    display: grid;
    gap: 0.6rem;
  }
  h2 {
    margin: 0;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .options {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 6px;
  }
  .options button {
    font-size: 0.9rem;
    padding: 0.6rem 0.3rem;
  }
  .options .on {
    background: var(--accent);
    color: #000;
    font-weight: 600;
  }
</style>
