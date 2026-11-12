<script lang="ts">
  import { onMount } from 'svelte'
  import ProgressRing from '../../ui/ProgressRing.svelte'
  import { formatClock } from '../../ui/format'
  import { MAX_CLIP_SECONDS } from '../limits'
  import { initialMachine, transition, type ButtonEvent, type MachineState } from './recordButtonMachine'

  let {
    disabled = false,
    onstart,
    onstop,
  }: {
    disabled?: boolean
    /** Startet die Aufnahme; `false` oder Exception → Button bleibt idle. */
    onstart: () => boolean
    onstop: () => void
  } = $props()

  let machine = $state<MachineState>(initialMachine)
  let startedAt = 0
  let elapsed = $state(0)
  let raf = 0

  const recording = $derived(machine.state !== 'idle')

  function send(e: ButtonEvent) {
    const { next, effect } = transition(machine, e)
    if (effect === 'start') {
      let ok = false
      try {
        ok = onstart()
      } catch (err) {
        console.error(err)
      }
      if (!ok) {
        machine = initialMachine
        return
      }
      startedAt = performance.now()
      elapsed = 0
      tick()
    } else if (effect === 'stop') {
      cancelAnimationFrame(raf)
      onstop()
    }
    machine = next
  }

  function tick() {
    elapsed = (performance.now() - startedAt) / 1000
    if (elapsed >= MAX_CLIP_SECONDS) {
      send({ type: 'interrupt' })
      return
    }
    raf = requestAnimationFrame(tick)
  }

  /** Von außen: Aufnahme sauber beenden (Screen verlassen etc.). */
  export function interrupt() {
    send({ type: 'interrupt' })
  }

  function onpointerdown(e: PointerEvent) {
    if (disabled || !e.isPrimary) return
    e.preventDefault()
    // Leichtes Verrutschen des Fingers soll nicht abbrechen.
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    send({ type: 'down', at: e.timeStamp })
  }

  function onpointerup(e: PointerEvent) {
    if (!e.isPrimary) return
    send({ type: 'up', at: e.timeStamp })
  }

  function onpointercancel(e: PointerEvent) {
    if (!e.isPrimary) return
    send({ type: 'cancel' })
  }

  onMount(() => {
    // Anruf oder App-Wechsel: Aufnahme beenden statt sie zu verlieren.
    const onHidden = () => document.visibilityState === 'hidden' && interrupt()
    document.addEventListener('visibilitychange', onHidden)
    window.addEventListener('pagehide', interrupt)
    return () => {
      document.removeEventListener('visibilitychange', onHidden)
      window.removeEventListener('pagehide', interrupt)
      cancelAnimationFrame(raf)
      interrupt()
    }
  })
</script>

<div class="wrap">
  {#if recording}
    <div class="timer">{formatClock(elapsed)}</div>
  {/if}
  <button
    class="record"
    class:pressing={machine.state === 'pressing'}
    class:tap={machine.state === 'recording-tap'}
    {disabled}
    aria-label={recording ? 'Aufnahme stoppen' : 'Aufnahme starten'}
    aria-pressed={recording}
    {onpointerdown}
    {onpointerup}
    {onpointercancel}
    oncontextmenu={(e) => e.preventDefault()}
  >
    <ProgressRing progress={recording ? elapsed / MAX_CLIP_SECONDS : 0} />
    <span class="dot"></span>
  </button>
</div>

<style>
  .wrap {
    position: relative;
    display: grid;
    place-items: center;
  }
  .timer {
    position: absolute;
    bottom: calc(100% + 8px);
    padding: 2px 10px;
    border-radius: 999px;
    background: var(--danger);
    font-variant-numeric: tabular-nums;
    font-weight: 600;
    font-size: 0.9rem;
  }
  .record {
    position: relative;
    width: 88px;
    height: 88px;
    padding: 0;
    border-radius: 50%;
    background: transparent;
    display: grid;
    place-items: center;
    /* iOS: kein Kontextmenü, keine Textauswahl, kein Scrollen beim Halten */
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
  }
  .dot {
    width: 70px;
    height: 70px;
    border-radius: 50%;
    background: var(--danger);
    transition:
      transform 150ms ease,
      border-radius 150ms ease,
      width 150ms ease,
      height 150ms ease;
  }
  .pressing .dot {
    transform: scale(0.82);
  }
  .tap .dot {
    width: 34px;
    height: 34px;
    border-radius: 8px;
  }
</style>
