<script lang="ts">
  import { store } from '../lib/project/store.svelte'
  import { formatClock, formatPrecise } from './format'
  import { toasts } from './toast.svelte'

  let {
    clipId,
    recording,
    recTime,
    playing,
    onrecord,
    onstoprecord,
    onpreview,
    onclose,
  }: {
    clipId: string
    recording: 'idle' | 'starting' | 'recording' | 'saving'
    recTime: number
    playing: boolean
    onrecord: () => void
    onstoprecord: () => void
    onpreview: () => void
    onclose: () => void
  } = $props()

  const clip = $derived(store.getClip(clipId))
  const index = $derived(store.project.clips.findIndex((c) => c.id === clipId))
  const volume = $derived(clip?.volume ?? 1)
  const music = $derived(store.project.music)
  const vo = $derived(store.project.voiceover)
  const multi = $derived(store.project.clips.length > 1)
  let loadingMusic = $state(false)
  let fileInput: HTMLInputElement | undefined = $state()

  const pct = (v: number) => Math.round(v * 100)
  const value = (e: Event) => Number((e.currentTarget as HTMLInputElement).value)

  async function onMusicChosen(e: Event) {
    const input = e.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    loadingMusic = true
    try {
      await store.setMusic(file)
    } catch (err) {
      toasts.show(err instanceof Error ? err.message : 'Musik konnte nicht geladen werden', 'error')
    } finally {
      loadingMusic = false
    }
  }
</script>

<div class="backdrop" onclick={onclose} role="presentation"></div>
<div class="sheet" role="dialog" aria-label="Ton">
  <header>
    <strong>Ton</strong>
    <button class="done" onclick={onclose}>Fertig</button>
  </header>

  {#if clip}
    <section>
      <span class="title">Clip {index + 1}</span>
      <div class="slider">
        <button
          class="mute"
          class:on={volume === 0}
          onclick={() => store.setVolume(clipId, volume === 0 ? 1 : 0)}
          aria-label={volume === 0 ? 'Ton an' : 'Stumm'}>{volume === 0 ? '🔇' : '🔊'}</button
        >
        <input
          type="range"
          min="0"
          max="100"
          step="1"
          value={pct(volume)}
          oninput={(e) => store.setVolume(clipId, value(e) / 100)}
          aria-label="Lautstärke des Clips"
        />
        <output>{pct(volume)} %</output>
      </div>
      {#if multi}
        <button class="link" onclick={() => store.setVolumeAll(volume)}>Lautstärke auf alle Clips anwenden</button>
      {/if}
    </section>

    <section>
      <span class="title">Musik</span>
      <input bind:this={fileInput} type="file" accept="audio/*" hidden onchange={onMusicChosen} />
      {#if music}
        <div class="row">
          <span class="name" title={music.name}>♪ {music.name}</span>
          <span class="muted">{formatClock(music.duration)}</span>
        </div>
        <label class="slider">
          <span>Lautstärke</span>
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            value={pct(music.volume)}
            oninput={(e) => store.updateMusic({ volume: value(e) / 100 })}
            aria-label="Lautstärke der Musik"
          />
          <output>{pct(music.volume)} %</output>
        </label>
        <label class="slider" class:off={store.maxMusicOffset <= 0}>
          <span>Start im Song</span>
          <input
            type="range"
            min="0"
            max={Math.max(0.1, store.maxMusicOffset)}
            step="0.5"
            value={music.offset}
            disabled={store.maxMusicOffset <= 0}
            oninput={(e) => store.updateMusic({ offset: value(e) })}
            aria-label="Start im Song"
          />
          <output>{formatClock(music.offset)}</output>
        </label>
        <label class="toggle">
          <input type="checkbox" checked={music.fadeOut} onchange={(e) => store.updateMusic({ fadeOut: e.currentTarget.checked })} />
          <span>Am Ende ausblenden</span>
        </label>
        <label class="toggle">
          <input type="checkbox" checked={music.duck} onchange={(e) => store.updateMusic({ duck: e.currentTarget.checked })} />
          <span>Leiser, wenn das Voiceover spricht</span>
        </label>
        <div class="actions">
          <button onclick={() => fileInput?.click()} disabled={loadingMusic}>Andere Musik</button>
          <button onclick={() => void store.removeMusic()}>Entfernen</button>
        </div>
      {:else}
        <button class="wide" onclick={() => fileInput?.click()} disabled={loadingMusic}>
          {loadingMusic ? 'Musik wird geladen …' : '♪ Musik wählen'}
        </button>
        <p class="hint">Eine Audiodatei (z. B. MP3 oder M4A) aus „Dateien“. Titel aus Apple Music sind geschützt.</p>
      {/if}
    </section>

    <section>
      <span class="title">Voiceover</span>
      {#if recording === 'recording' || recording === 'starting'}
        <button class="wide rec" onclick={onstoprecord} disabled={recording === 'starting'}>
          <span class="dot"></span>
          {recording === 'starting' ? 'Mikrofon startet …' : `Stopp · ${formatPrecise(recTime)}`}
        </button>
        <p class="hint">Sprich jetzt. Die Aufnahme endet automatisch mit dem Video.</p>
      {:else if recording === 'saving'}
        <button class="wide" disabled>Aufnahme wird gespeichert …</button>
      {:else if vo}
        <div class="row">
          <span class="name">🎙 Aufnahme</span>
          <span class="muted">{formatPrecise(Math.max(0, vo.duration - vo.skip))}</span>
        </div>
        <label class="slider">
          <span>Lautstärke</span>
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            value={pct(vo.volume)}
            oninput={(e) => store.updateVoiceover({ volume: value(e) / 100 })}
            aria-label="Lautstärke des Voiceovers"
          />
          <output>{pct(vo.volume)} %</output>
        </label>
        <div class="actions">
          <button onclick={onrecord}>Neu aufnehmen</button>
          <button onclick={() => void store.removeVoiceover()}>Löschen</button>
        </div>
      {:else}
        <button class="wide" onclick={onrecord}>🎙 Aufnehmen</button>
        <p class="hint">Das Video läuft von vorn, du sprichst darüber. Tipp: Mit Kopfhörern sprechen.</p>
      {/if}
    </section>

    {#if music || vo}
      <button class="wide" onclick={onpreview} disabled={recording !== 'idle'}>
        {playing ? '■ Stopp' : '▶ Alles mit Ton anhören'}
      </button>
    {/if}
  {/if}
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 40;
    background: transparent;
  }
  .sheet {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 41;
    max-height: 66dvh;
    overflow-y: auto;
    padding: 14px 16px calc(16px + var(--safe-bottom));
    background: var(--surface);
    border-radius: 18px 18px 0 0;
    box-shadow: 0 -8px 30px rgba(0, 0, 0, 0.5);
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .done {
    background: var(--accent);
    color: #000;
    font-weight: 600;
  }
  section {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .title {
    font-size: 0.8rem;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .slider {
    display: grid;
    grid-template-columns: 96px 1fr 48px;
    align-items: center;
    gap: 10px;
    font-size: 0.9rem;
  }
  .slider.off {
    opacity: 0.5;
  }
  .slider input {
    width: 100%;
    accent-color: var(--accent);
  }
  .slider output {
    text-align: right;
    font-variant-numeric: tabular-nums;
    font-size: 0.8rem;
  }
  .mute {
    min-height: 0;
    padding: 0.35rem 0;
    font-size: 1.1rem;
  }
  .mute.on {
    background: var(--danger);
  }
  .row {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    font-size: 0.9rem;
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .muted,
  .hint {
    color: var(--muted);
    font-size: 0.8rem;
  }
  .hint {
    margin: 0;
  }
  .toggle {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 0.9rem;
  }
  .toggle input {
    width: 20px;
    height: 20px;
    accent-color: var(--accent);
  }
  .link {
    align-self: flex-start;
    background: none;
    padding: 0;
    min-height: 0;
    color: var(--accent);
    font-size: 0.85rem;
  }
  .actions {
    display: flex;
    gap: 8px;
  }
  .actions button,
  .wide {
    flex: 1;
  }
  .rec {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    background: var(--danger);
    color: #fff;
    font-weight: 600;
  }
  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #fff;
    animation: blink 1s infinite;
  }
  @keyframes blink {
    50% {
      opacity: 0.2;
    }
  }
</style>
