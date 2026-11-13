<script lang="ts">
  import { pwaUpdate } from '../lib/platform/pwaUpdate.svelte'
  import { router } from '../lib/router.svelte'
  import { settings, type DefaultFacing } from '../lib/settings.svelte'
  import Screen from '../ui/Screen.svelte'

  const FACINGS: { value: DefaultFacing; label: string }[] = [
    { value: 'user', label: 'Vorne' },
    { value: 'environment', label: 'Hinten' },
    { value: 'last', label: 'Zuletzt benutzt' },
  ]

  const built = new Date(__BUILD_TIME__).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })
  let checked = $state(false)

  async function checkUpdate() {
    await pwaUpdate.check()
    checked = true
  }
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

  <section>
    <h2>App</h2>
    <p class="version">Version vom {built}</p>
    {#if pwaUpdate.pending}
      <button class="primary" onclick={() => location.reload()}>Update installieren</button>
    {:else if pwaUpdate.supported}
      <button onclick={checkUpdate} disabled={pwaUpdate.checking}>
        {pwaUpdate.checking ? 'Suche …' : checked ? 'Aktuell – erneut prüfen' : 'Nach Update suchen'}
      </button>
    {/if}
  </section>
</Screen>

<style>
  section + section {
    margin-top: 1.5rem;
  }
  .primary {
    background: var(--accent);
    color: #000;
    font-weight: 600;
  }
  .version {
    margin: 0;
    color: var(--muted);
    font-size: 0.9rem;
  }
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
