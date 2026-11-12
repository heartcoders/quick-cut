# Quick Cut

Mobile-first Web App zum Aufnehmen, Importieren, Schneiden und Exportieren kurzer Videos – komplett lokal im Browser (Vite + Svelte 5 + TypeScript, kein Backend).

## Entwicklung

```bash
npm install
npm run dev      # HTTPS-Dev-Server, auch im LAN erreichbar
npm test         # Vitest
npm run check    # svelte-check + TypeScript
npm run build
```

**Test auf dem Handy:** `npm run dev` zeigt eine `Network`-URL (`https://<LAN-IP>:5173`). Auf dem Handy öffnen und die Warnung zum selbstsignierten Zertifikat einmal bestätigen. HTTPS ist Pflicht, sonst blockiert der Browser die Kamera.

## Ablauf

1. **Aufnahme** (`#/record`): Tippen = Aufnahme bis zum nächsten Tippen, Halten = solange der Finger liegt. Galerie-Button importiert Videos.
2. **Schneiden** (`#/cut`): Start/Ende per Griff oder ±0,1 s, Clip oder alles abspielen. Zwischen den Clips Übergänge (Überblenden, Schieben, Wischen) wählen – Vorschau und Export laufen über denselben Renderer.
3. **Export** (`#/export`): Format 9:16 / 1:1 / 16:9 wählen, in Echtzeit exportieren (Canvas + MediaRecorder), dann über das Share Sheet in Fotos sichern bzw. herunterladen.

## Struktur

- `src/lib/project` – Typen, IndexedDB (`idb`), Projekt-Store (Runes)
- `src/lib/router.svelte.ts` – Hash-Router (`#/record`, `#/cut`, `#/export`)
- `src/lib/capture` – Kamera, MediaRecorder, Record-Button (Zustandsmaschine)
- `src/lib/media` – Probe, Filmstreifen, Pipeline, Player (Trim-Bereich, A/B-Sequenz)
- `src/lib/import` – Galerie-Import
- `src/lib/timeline` – Zeitberechnung (resolve, Trim-Griffe)
- `src/lib/renderer` – WebGL2-Compositor (Fallback Canvas 2D), Audio-Graph
- `src/lib/export` – Export v1
- `src/lib/platform` – Formatwahl, Teilen/Download, Wake Lock
- `src/routes` – die drei Screens
- `src/ui` – gemeinsame UI-Komponenten
