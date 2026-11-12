<script lang="ts">
  /**
   * Quell-Videos für den Renderer (A/B). Sie liegen bildschirmgroß *hinter*
   * einer schwarzen Abdeckung: iOS dekodiert und taktet nur Videos, die es für
   * sichtbar hält (nicht 1 px groß / Opacity 0), zu sehen sind sie trotzdem nicht.
   */
  let {
    a = $bindable(),
    b = $bindable(),
  }: { a?: HTMLVideoElement | undefined; b?: HTMLVideoElement | undefined } = $props()
</script>

<div class="sources" aria-hidden="true">
  <!-- svelte-ignore a11y_media_has_caption -->
  <video bind:this={a} playsinline preload="auto"></video>
  <!-- svelte-ignore a11y_media_has_caption -->
  <video bind:this={b} playsinline preload="auto"></video>
</div>
<div class="cover" aria-hidden="true"></div>

<style>
  .sources,
  .cover {
    position: fixed;
    inset: 0;
    z-index: -1;
    pointer-events: none;
  }
  .sources video {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
  .cover {
    background: var(--bg, #000);
  }
</style>
